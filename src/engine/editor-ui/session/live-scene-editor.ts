import { Store } from "@tanstack/store";
import type * as Y from "yjs";

import {
  actorLabel,
  applyEntityDiff,
  bindSceneDoc,
  expandLenient,
  layoutFromDoc,
  observeProjectPeers,
  PRESENCE_FIELD,
  projectPeers,
  readDoc,
  sessionPrefabSource,
  setProjectPresence,
  type AssetChangedMessage,
  type AwarenessLike,
  type BindableRuntime,
  type CodeSkewIssue,
  type LogEntry,
  type PrefabSource,
  type ProjectPeer,
  type ProjectPresence,
  type ProjectSession,
  type SceneBinding,
  type SceneOrigin,
  type ScenePresence,
  type SessionDoc,
  type SessionPrefabSource,
  type UndoneStep,
} from "../../collab/index";
import {
  createEditorSession,
  createVariantBatch,
  docRefs,
  openPrefabIsolation,
  projectHistory,
  selectionBounds,
  type EditorSession,
  type EditorSessionOptions,
  type OpBatch,
  type PrefabIsolation,
  type Ref,
  type SessionHistory,
} from "../../editor/index";
import { withProject, type Registry } from "../../game/index";
import type { GameInstance, PlayOptions, PlayReport, RunRecording } from "../../index";
import {
  MATERIAL_KIND,
  parseDocName,
  prefabKind,
  RUNTIME_VIEW_KINDS,
  runtimeView,
  stableJson,
  type AssetEntry,
  type AssetId,
  type ProjectRuntimeView,
} from "../../project/index";
import {
  nextFreeId,
  type InstanceDef,
  type Prefab,
  type RuntimeEntity,
  type SceneDefinition,
} from "../../scene/index";
import type { SceneDocStatus } from "../connect/scene-doc";
import { frameInView } from "../frame/visible-rect";
import { defaultPeerColor, guestName, type EditorNotify } from "../host";
import { createPending, type Pending } from "../pending/pending";

/** The pending scope of opening the prefab an instance (`ref`) places: its outliner row and Open prefab button. */
export const openPrefabScope = (ref: Ref): string => `prefab:open:${ref}`;

/** The pending scope of the prefab header's actions: opening the variant's base, and Create variant. */
export const PREFAB_HEADER_SCOPE = "prefab:header";

/** The pending task ids the prefab header tells its buttons apart by. */
export const openPrefabTask = (prefab: string): string => `prefab:open:${prefab}`;
export const createVariantTask = (base: string): string => `prefab:variant:${base}`;

/** What the editor's chrome shows besides the session: the connection, play state and access. */
export type EditorHostState = {
  connection: SceneDocStatus;
  /** Updates the server hasn't acknowledged yet; zero once it holds every edit. */
  unsynced?: number;
  /** The doc moved on since Play started. */
  sceneChanged: boolean;
  /** Why the doc on screen may only be read: a newer build of the game changed its kind's schema. */
  readOnly?: CodeSkewIssue | null;
};

export type EditorIdentity = {
  origin: Extract<SceneOrigin, { kind: "user" }>;
  user: ScenePresence["user"];
};

/** The parts of a `GameInstance` the live editor drives. */
export type EditorGame = Pick<
  GameInstance,
  | "registry"
  | "loadScene"
  | "runtime"
  | "play"
  | "replay"
  | "stop"
  | "setMode"
  | "setPrefabs"
  | "frame"
  | "panBy"
>;

/** The project session a scene doc belongs to, and that doc's name in it. */
export type LiveEditorProject = { session: ProjectSession; doc: string };

export type LiveEditorOptions = {
  game: EditorGame;
  doc: Y.Doc;
  awareness?: AwarenessLike | null;
  name: string;
  identity: EditorIdentity;
  /** Where refusals, remote edits and undo elsewhere are announced. */
  notify: EditorNotify;
  /** The editor's tasks: opening a prefab and creating a variant run through it. Default: one of its own. */
  pending?: Pending;
  issuesDebounceMs?: number;
  /** Where the scene's prefabs come from and are written; by default the project's prefab docs, else none. */
  prefabs?: EditorSessionOptions["prefabs"];
  /** Undo and history from elsewhere; by default the project's one stack, else the doc's own. */
  history?: SessionHistory;
  /**
   * The project `doc` is open in, with the same origin as `identity`: the
   * editor then edits its prefab docs, steps its one undo stack, publishes
   * where this client is, and refuses writes to docs this build may only read.
   * `game.registry` is then the project's (`projectRegistry`), so the doc's
   * project materials bind, validate and play.
   */
  project?: LiveEditorProject;
};

/** The prefab open in isolation, as its header shows it. */
export type OpenPrefabLink = {
  id: string;
  scene: string;
  onBack: () => void;
  /** Opens another prefab in its place, such as this variant's base. */
  onOpen?: (prefab: string) => void;
  /** Creates a variant of this prefab and opens it. */
  onCreateVariant?: () => void;
};

/** What the editor's panels edit: the scene's session, or an open prefab's with its way back. */
export type EditingTarget = {
  session: EditorSession;
  /** Opens a prefab on its own; absent while one is open. */
  onOpenPrefab?: (prefab: string, from: Ref) => void;
  /** The prefab `session` edits in isolation, and the way back to its scene. */
  prefab?: OpenPrefabLink;
};

/** A prefab open on its own, and the scene ref the editor goes back to. */
export type OpenPrefab = { isolation: PrefabIsolation; from?: Ref };

export type LiveEditor = {
  session: EditorSession;
  host: Store<EditorHostState>;
  /** The prefab being edited in isolation, if any; the edit world shows it instead of the scene. */
  prefab: Store<OpenPrefab | null>;
  /** Everyone else in the project and the doc each is in, for the project tree; empty without a project. */
  projectPeers: Store<readonly ProjectPeer[]>;
  /**
   * Edits `prefab` on its own once its doc opens, as a pending task scoped to
   * `from`'s row (`openPrefabScope`); `from` (an instance) is framed again on
   * Back. Opening it again while it opens joins that. False while playing or
   * when there is no such prefab.
   */
  openPrefab: (prefab: string, from?: Ref) => boolean;
  /** Back to the scene from an open prefab. */
  closePrefab: () => void;
  /** Creates a variant of `base` and opens it; false, with a notice, when it can't. */
  createVariant: (base: string) => boolean;
  /** What the editor's chrome edits with `open` (from `prefab`): the scene, or that prefab with its way back. */
  editing: (open: OpenPrefab | null) => EditingTarget;
  /** Plays the doc as it is now (from `opts.at` for "play from here"); false, with a notice, when it can't. */
  play: (opts?: PlayOptions) => boolean;
  /** Plays a recording's input again on the doc as it is now; false, with a notice, when it can't. */
  replay: (recording: RunRecording) => boolean;
  /** True while the play world is a replay. */
  replaying: () => boolean;
  stop: () => void;
  /** Rebuilds the running play world from the latest doc, from where the last Play started. */
  restart: () => void;
  destroy: () => void;
};

/**
 * This tab as an editor: an id per page load, so two tabs are two people
 * with their own undo and colour, named after the host's identity when it
 * has one.
 */
export function editorIdentity(
  displayName?: string | null,
  peerColor: (id: string) => string = defaultPeerColor,
): EditorIdentity {
  const id = `tab-${Math.random().toString(36).slice(2).padEnd(8, "0").slice(0, 8)}`;
  const name = displayName?.trim() || guestName();
  return {
    origin: { kind: "user", userId: id, name },
    user: { id, name, color: peerColor(id) },
  };
}

const plural = (n: number, word: string) => (n === 1 ? `1 ${word}` : `${n} ${word}s`);

/** Why Play didn't start: the scene's errors, a start inside a solid, or a load that failed. */
function playRefused(notify: EditorNotify, report: Extract<PlayReport, { ok: false }>): void {
  const errors = report.issues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    notify.error(`Fix ${plural(errors.length, "error")} before you play`, {
      description: errors[0]!.message,
    });
  } else if (report.reason === "spawn-blocked") {
    notify.error("Can't play from here", { description: report.error });
  } else {
    notify.error("The scene failed to load", { description: report.error });
  }
}

/** Agents' and the file's batches land without anyone in the editor doing them, so they're announced. */
function announce(notify: EditorNotify, entry: LogEntry): void {
  if (entry.actor.kind === "agent") {
    notify(`${actorLabel(entry.actor)} edited the scene`, { description: entry.label });
  } else if (entry.actor.kind === "disk") {
    notify("The scene file changed on disk", { description: entry.label });
  }
}

/** Resolves once every live prefab of the project has its doc open. */
export async function prefabsReady(project: ProjectSession): Promise<void> {
  const source = sessionPrefabSource(project);
  try {
    await source.ready();
  } finally {
    source.destroy();
  }
}

/** A project's registry and runtime data, kept in step with its material and runtime-view (game-settings, data-table, input-map) assets. */
export type ProjectRegistry = {
  /** The session's registry with the project's live material assets overlaid by id; the session's own while it has none. */
  current(): Registry;
  /** What the project's game code reads as `EngineContext.project`: its game settings and tables as their docs hold them. */
  project(): ProjectRuntimeView;
  /** Resolves once every live material and runtime-view (game-settings, data-table, input-map) doc has opened, so `current()` and `project()` hold them all. */
  ready(): Promise<void>;
  /** Fires when `current()` or `project()` changes: one of those assets was added, deleted or edited. */
  subscribe(listener: () => void): () => void;
  /**
   * Hot reload of art: once the project doc holds the hash an `asset:changed`
   * message names, `project()` is rebuilt in place (no `subscribe` listener
   * fires, so the host keeps its game) and `game.reloadAssets` redraws what
   * uses the asset, as a `pending` hold while it runs. Returns the unsubscribe.
   */
  followAssets(
    changes: AssetChangeSource,
    game: Pick<GameInstance, "reloadAssets">,
    opts?: { pending?: Pending },
  ): () => void;
  destroy(): void;
};

/** Where `asset:changed` messages come from: the project session's link. */
export type AssetChangeSource = {
  onAssetChanged(listener: (message: AssetChangedMessage) => void): () => void;
};

const warnInConsole = (message: string): void => console.warn(`[assets] ${message}`);

/** What a reload names: the one asset's file name, else how many. */
function reloadName(view: ReturnType<ProjectSession["view"]>, changed: readonly AssetId[]): string {
  if (changed.length !== 1) return `${changed.length} assets`;
  const id = changed[0]!;
  return view.byId.get(id)?.path.split("/").at(-1) ?? id;
}

const isWatchedKind = (kind: string): boolean =>
  kind === MATERIAL_KIND || RUNTIME_VIEW_KINDS.includes(kind);

/**
 * The registry a project's docs are read, validated and built with: the
 * session's code registry with the project's material assets overlaid
 * (`withProject`), rebuilt only when a material's value changes. The
 * session itself keeps its code registry, which its schema hashes come from.
 * Beside it, the project's runtime view (`runtimeView`) from its
 * runtime-view (game-settings, data-table, input-map) docs, rebuilt only
 * when one of their values changes.
 */
export function projectRegistry(
  session: ProjectSession,
  opts: {
    /** Where a hot reload's failures go; default the console. */
    warn?: (message: string) => void;
  } = {},
): ProjectRegistry {
  const warn = opts.warn ?? warnInConsole;
  const warnReload = (message: string) => warn(`hot reload: ${message}`);
  type Held = { doc: SessionDoc | null; opened: Promise<void>; off: () => void };
  const held = new Map<string, Held>();
  const listeners = new Set<() => void>();
  let current = session.registry;
  let project = runtimeView(session.view(), new Map(), session.registry);
  let materialsKey: string | null = null;
  let dataKey: string | null = null;
  let destroyed = false;

  const watched = () =>
    [...session.view().byId.values()]
      .filter((e) => isWatchedKind(e.kind))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  function valuesOf(entries: readonly AssetEntry[]) {
    const values = new Map<AssetId, unknown>();
    for (const entry of entries) {
      const name = session.docNameFor(entry);
      const doc = name ? held.get(name)?.doc : null;
      values.set(entry.id, doc?.layout ? layoutFromDoc(doc.doc, doc.layout) : null);
    }
    return values;
  }

  const dataValues = (entries: readonly AssetEntry[]) =>
    valuesOf(entries.filter((e) => e.kind !== MATERIAL_KIND));

  function rebuild() {
    if (destroyed) return;
    const view = session.view();
    const entries = watched();
    const materials = valuesOf(entries.filter((e) => e.kind === MATERIAL_KIND));
    const data = dataValues(entries);
    const nextMaterials = stableJson([...materials]);
    // Settings and tables also depend on where each asset sits, which orders them.
    const nextData = stableJson([...data].map(([id, v]) => [id, view.byId.get(id)?.path, v]));
    const first = materialsKey === null;
    let changed = false;
    if (nextMaterials !== materialsKey) {
      materialsKey = nextMaterials;
      current =
        materials.size === 0 ? session.registry : withProject(session.registry, view, materials);
      changed = true;
    }
    if (nextData !== dataKey) {
      dataKey = nextData;
      project = runtimeView(view, data, session.registry);
      changed = true;
    }
    if (changed && !first) for (const l of listeners) l();
  }

  function open(name: string) {
    const entry: Held = { doc: null, opened: Promise.resolve(), off: () => {} };
    held.set(name, entry);
    entry.opened = session.open(name).then(
      (doc) => {
        if (destroyed || held.get(name) !== entry) return session.release(name);
        entry.doc = doc;
        doc.doc.on("update", rebuild);
        entry.off = () => doc.doc.off("update", rebuild);
        rebuild();
      },
      // An asset whose doc can't open is left out.
      () => {},
    );
  }

  function letGo(name: string, entry: Held) {
    held.delete(name);
    entry.off();
    if (entry.doc) session.release(name);
  }

  function sync() {
    if (destroyed) return;
    const wanted = new Set<string>();
    for (const entry of watched()) {
      const name = session.docNameFor(entry);
      if (name) wanted.add(name);
    }
    for (const [name, entry] of held) if (!wanted.has(name)) letGo(name, entry);
    for (const name of wanted) if (!held.has(name)) open(name);
    rebuild();
  }

  session.projectDoc.on("update", sync);
  sync();

  return {
    current: () => current,
    project: () => project,
    async ready() {
      await Promise.all([...held.values()].map((e) => e.opened));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    followAssets(changes, game, { pending: tasks } = {}) {
      const pending = new Map<AssetId, AssetChangedMessage["sha256"]>();
      // The message can arrive before the doc update that carries its hash.
      const flush = () => {
        if (destroyed || pending.size === 0) return;
        const view = session.view();
        const changed: AssetId[] = [];
        for (const [id, sha256] of pending) {
          if (view.byId.get(id)?.sha256 !== sha256) continue;
          pending.delete(id);
          changed.push(id);
        }
        if (changed.length === 0) return;
        project = runtimeView(view, dataValues(watched()), session.registry);
        changed.sort();
        const release = tasks?.hold({
          id: "art:reload",
          label: `Reloading ${reloadName(view, changed)}`,
          scope: "editor",
        });
        game
          .reloadAssets({ project, view, changed })
          .then(({ errors }) => {
            for (const { entityId, error } of errors) warnReload(`${entityId}: ${error}`);
            release?.();
          })
          .catch((err: unknown) => {
            if (release) release({ error: err, errorTitle: "The art couldn't reload" });
            else warnReload(err instanceof Error ? err.message : String(err));
          });
      };
      const off = changes.onAssetChanged((message) => {
        pending.set(message.id, message.sha256);
        flush();
      });
      session.projectDoc.on("update", flush);
      return () => {
        off();
        session.projectDoc.off("update", flush);
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      session.projectDoc.off("update", sync);
      for (const [name, entry] of held) letGo(name, entry);
      listeners.clear();
    },
  };
}

const isSessionSource = (source: PrefabSource): source is SessionPrefabSource =>
  "session" in source && "docName" in source;

/**
 * A variant's base children as the edit world draws them in isolation:
 * resolved with the variant's overrides and params, under a placement
 * named after the base (`post/top`) so they never clash with the variant's
 * own. The variant's doc doesn't hold them, so nothing picks or edits them.
 * Empty for a prefab that isn't a variant.
 */
function variantBaseEntities(
  own: SceneDefinition,
  prefabId: string,
  library: ReadonlyMap<string, Prefab>,
  registry: Registry,
): RuntimeEntity[] {
  const variant = library.get(prefabId);
  if (variant?.base === undefined) return [];
  const { bulk: _bulk, instances: _instances, ...header } = variant;
  const baseOnly = new Map(library).set(prefabId, { ...header, entities: [] });
  const taken = new Set([
    ...(own.entities ?? []).map((e) => e.id),
    ...(own.instances ?? []).map((i) => i.id),
  ]);
  const placement: InstanceDef = {
    id: nextFreeId(variant.base, taken),
    prefab: prefabId,
    at: [0, 0],
  };
  const def: SceneDefinition = {
    v: own.v,
    ...(own.game !== undefined ? { game: own.game } : {}),
    name: own.name,
    bounds: own.bounds,
    ...(own.settings ? { settings: own.settings } : {}),
    instances: [placement],
  };
  return expandLenient(def, registry, baseOnly).scene.entities;
}

/**
 * `runtime` with a variant's base children laid over what the binding
 * loads, kept in step as the variant's overrides, its base or the prefabs
 * under it change; `reload` rebuilds the world when a step can't apply.
 */
function withVariantBase(
  runtime: BindableRuntime,
  target: EditorSession,
  prefabId: string,
  reload: () => void,
): { runtime: BindableRuntime; setPaused(paused: boolean): void; destroy(): void } {
  let held: RuntimeEntity[] = [];
  let paused = false;
  const compute = () =>
    variantBaseEntities(target.getDoc(), prefabId, target.prefabs.library(), target.registry);

  function refresh() {
    if (paused) return;
    const next = compute();
    const before = held;
    held = next;
    if (!applyEntityDiff(runtime, before, next)) reload();
  }

  const offPrefabs = target.prefabs.subscribe(refresh);
  const offDoc = target.subscribe(refresh);
  return {
    runtime: {
      load(scene) {
        held = compute();
        return runtime.load({ ...scene, entities: [...scene.entities, ...held] });
      },
      add: (entities) => runtime.add(entities),
      update: (entities) => runtime.update(entities),
      remove: (ids) => runtime.remove(ids),
    },
    setPaused(next) {
      paused = next;
    },
    destroy() {
      offPrefabs();
      offDoc();
    },
  };
}

/** Scene ops that write prefab docs. */
const writesPrefabs = (op: string): boolean =>
  op === "applyToPrefab" || op === "createPrefab" || op === "definePrefab";

/**
 * The editor on a shared doc, driving `game`: the edit world follows the
 * doc through `bindSceneDoc`; Play validates a snapshot of the doc and
 * builds a fresh world from it, leaving the binding paused so nobody's
 * edits reach a running game; Stop discards it and rebuilds from the doc
 * as it is then. In a project, a prefab opens on its own doc, and undo
 * steps back through this client's last step wherever it was, with a notice
 * when that was in a doc not on screen.
 */
export function openLiveEditor({
  game,
  doc,
  awareness,
  name,
  identity,
  notify,
  pending,
  issuesDebounceMs,
  prefabs,
  history,
  project: inProject,
}: LiveEditorOptions): LiveEditor {
  const tasks = pending ?? createPending({ notify });
  const project = inProject?.session ?? null;
  const sceneDoc = inProject?.doc ?? null;
  /** The doc the editor shows: the scene's, or the open prefab's. */
  let onScreen: string | null = sceneDoc;

  const idOf = (docName: string): string => {
    const ref = parseDocName(docName);
    if (!ref || ref.kind === "project") return docName;
    return project?.state().assets[ref.key]?.id ?? ref.key;
  };

  const onUndone = (step: UndoneStep, how: "undo" | "redo") => {
    if (onScreen && step.docs.includes(onScreen)) return;
    const where = step.docs.filter((d) => d !== project?.name).map(idOf);
    const verb = how === "undo" ? "Undid" : "Redid";
    notify(`${verb} ${step.label} in ${where.length > 0 ? where.join(", ") : "the project"}`);
  };

  const ownSource =
    !prefabs && project && sceneDoc
      ? sessionPrefabSource(project, { scene: idOf(sceneDoc) })
      : null;
  const source = prefabs ?? ownSource ?? undefined;
  const sceneHistory =
    history ?? (project && sceneDoc ? projectHistory(project, sceneDoc, { onUndone }) : undefined);

  const skewOf = (docName: string | null): CodeSkewIssue | null =>
    (project && docName ? project.get(docName)?.issue : undefined) ?? null;

  /** `target` with its writes refused while `docName` may only be read, and a scene's prefab writes while prefabs may only be read. */
  function guarded(target: EditorSession, docName: string | null, scene: boolean): EditorSession {
    if (!project || !docName) return target;
    const refusal = (batch?: OpBatch): CodeSkewIssue | null =>
      skewOf(docName) ??
      (scene && batch?.ops.some((op) => writesPrefabs(op.op))
        ? project.skewFor(prefabKind.kind)
        : null);
    return {
      ...target,
      dispatch(batch, opts) {
        const issue = refusal(batch);
        if (issue) return { ok: false, hash: target.getHash(), failedAt: 0, issue };
        return target.dispatch(batch, opts);
      },
      revert(entryId) {
        const issue = refusal();
        return issue ? { ok: false, issue } : target.revert(entryId);
      },
    };
  }

  const host = new Store<EditorHostState>({
    connection: "live",
    sceneChanged: false,
    readOnly: skewOf(sceneDoc),
  });
  const session = guarded(
    createEditorSession({
      doc,
      origin: identity.origin,
      name,
      registry: game.registry,
      ...(awareness ? { awareness } : {}),
      user: identity.user,
      ...(issuesDebounceMs !== undefined ? { issuesDebounceMs } : {}),
      ...(source ? { prefabs: source } : {}),
      ...(sceneHistory ? { history: sceneHistory } : {}),
      ...(project ? { project } : {}),
    }),
    sceneDoc,
    true,
  );

  const presence = (patch: Partial<ProjectPresence>) => {
    if (project) setProjectPresence(project.awareness, patch);
  };
  /** What this client published in the scene's awareness while it is in a prefab, put back on Back. */
  let away: { value: unknown } | null = null;
  /** Puts `docName` on screen: this client's presence and the read-only notice follow it. */
  const showing = (docName: string | null) => {
    onScreen = docName;
    if (awareness) {
      const inScene = docName === sceneDoc;
      if (!inScene && !away) {
        away = { value: awareness.getLocalState()?.[PRESENCE_FIELD] ?? null };
        awareness.setLocalStateField(PRESENCE_FIELD, null);
      } else if (inScene && away) {
        awareness.setLocalStateField(PRESENCE_FIELD, away.value);
        away = null;
      }
    }
    presence({ doc: docName });
    host.setState((s) => ({ ...s, readOnly: skewOf(docName) }));
  };
  presence({ user: identity.user, doc: onScreen, mode: "edit" });

  const projectPeerStore = new Store<readonly ProjectPeer[]>(
    project ? projectPeers(project.awareness) : [],
  );
  const offPeers = project
    ? observeProjectPeers(project.awareness, (peers) => projectPeerStore.setState(() => peers))
    : () => {};
  const offAccess = project
    ? project.subscribe((e) => {
        if (e.type === "access" && e.doc === onScreen)
          host.setState((s) => ({ ...s, readOnly: e.issue ?? null }));
      })
    : () => {};

  const runtime: BindableRuntime = {
    load: (scene) => game.loadScene(scene),
    add: (entities) => game.runtime()?.add(entities) ?? { ok: false },
    update: (entities) => game.runtime()?.update(entities) ?? { ok: false },
    remove: (ids) => game.runtime()?.remove(ids),
  };

  let playing = false;
  let started: PlayOptions | undefined;
  let replayed: RunRecording | null = null;
  game.stop();
  /** Binds the edit world to `target`'s doc; in a prefab's isolation, a variant's base shows too. */
  const bind = (target: EditorSession, isolated?: string): SceneBinding => {
    const base =
      isolated === undefined
        ? null
        : withVariantBase(runtime, target, isolated, () => binding.reload());
    const binding = bindSceneDoc(target.doc, base?.runtime ?? runtime, game.registry, {
      prefabs: target.prefabs,
      ...(target.parentBounds ? { parentBounds: target.parentBounds } : {}),
      onChange: () => {
        if (playing && !host.state.sceneChanged)
          host.setState((s) => ({ ...s, sceneChanged: true }));
      },
      onSkipped: (errors) =>
        notify.warning("Some entities couldn't be built", {
          id: "scene-skipped",
          description: errors[0],
        }),
    });
    if (!base) return binding;
    return {
      ...binding,
      setPaused(paused) {
        base.setPaused(paused);
        binding.setPaused(paused);
      },
      destroy() {
        base.destroy();
        binding.destroy();
      },
    };
  };
  let binding = bind(session);
  const prefab = new Store<OpenPrefab | null>(null);
  /** Bumped by every open and close, so an isolation that opens late is dropped. */
  let opening = 0;

  /** Points the edit world at `target`'s doc, framing what `refs` cover in it. */
  function show(target: EditorSession, refs: readonly Ref[], isolated?: string) {
    binding.destroy();
    binding = bind(target, isolated);
    const box = selectionBounds(target.getResolved(), target.registry, refs);
    if (box) frameInView(game, box);
  }

  function closePrefab() {
    opening++;
    const open = prefab.state;
    if (!open || playing) return;
    prefab.setState(() => null);
    open.isolation.close();
    showing(sceneDoc);
    show(session, open.from ? [open.from] : []);
  }

  /** The prefab's doc name and the project's history over it, once its doc is open. */
  async function prefabDoc(
    id: string,
  ): Promise<{ docName: string | null; history?: SessionHistory }> {
    const from = session.prefabs;
    if (!project || !isSessionSource(from) || from.session !== project) return { docName: null };
    await from.open(id);
    const docName = from.docName(id);
    if (!docName || !project.get(docName)) return { docName: null };
    return { docName, history: projectHistory(project, docName, { onUndone }) };
  }

  /** The open and variant tasks in flight, by task id: pressing again joins them. */
  const running = new Set<string>();

  function openPrefab(
    id: string,
    from?: Ref,
    scope = from !== undefined ? openPrefabScope(from) : PREFAB_HEADER_SCOPE,
    task = { id: openPrefabTask(id), label: `Opening ${id}` },
  ): boolean {
    if (playing) return false;
    if (running.has(task.id)) return true;
    if (!session.getPrefabs().has(id)) {
      notify.error(`No prefab ${id} in this scene`);
      return false;
    }
    const ticket = ++opening;
    let isolation: PrefabIsolation | null = null;
    running.add(task.id);
    void tasks
      .run({ ...task, scope, error: `Prefab ${id} couldn't be opened` }, async () => {
        const { docName, history: prefabHistory } = await prefabDoc(id);
        const opened = await openPrefabIsolation(session, id, {
          user: identity.user,
          ...(issuesDebounceMs !== undefined ? { issuesDebounceMs } : {}),
          ...(prefabHistory ? { history: prefabHistory } : {}),
          onGone: () => {
            if (!isolation || prefab.state?.isolation !== isolation) return;
            prefab.setState(() => null);
            showing(sceneDoc);
            binding.destroy();
            binding = bind(session);
            notify("The prefab was deleted", {
              description: `${id} is gone, so you're back in the scene.`,
            });
          },
        });
        if (!opened) {
          if (ticket === opening) throw new Error(`${id}'s doc didn't open.`);
          return;
        }
        if (ticket !== opening || playing) {
          opened.close();
          return;
        }
        // The prefab on screen stays, with its header, until this one is ready to take its place.
        const before = prefab.state;
        if (before) {
          before.isolation.close();
          if (!docName) showing(sceneDoc);
        }
        isolation = { ...opened, session: guarded(opened.session, docName, false) };
        prefab.setState(() => ({ isolation: isolation!, ...(from ? { from } : {}) }));
        if (docName) showing(docName);
        show(isolation.session, docRefs(isolation.session.getDoc()), id);
      })
      .finally(() => running.delete(task.id));
    return true;
  }

  /** Live, the project's prefab writer creates the variant's doc, as it does for Create prefab. */
  function createVariant(base: string): boolean {
    if (playing) return false;
    const task = { id: createVariantTask(base), label: `Creating a variant of ${base}` };
    if (running.has(task.id)) return true;
    const made = createVariantBatch(base, session.getPrefabs(), {
      taken: project ? project.view().byId.keys() : [],
    });
    if (!made) {
      notify.error(`No prefab ${base} in this scene`);
      return false;
    }
    const result = session.dispatch(made.scene);
    if (!result.ok) {
      notify.error(`Couldn't create a variant of ${base}`, { description: result.issue.message });
      return false;
    }
    return openPrefab(made.id, prefab.state?.from, PREFAB_HEADER_SCOPE, task);
  }

  const unsubscribe = session.subscribe((e) => {
    if (e.source === "remote") for (const entry of e.logged) announce(notify, entry);
  });

  /** Plays the doc as it is now; on a refusal the world that was running keeps running. */
  function launch(opts: PlayOptions | undefined, recording: RunRecording | null): boolean {
    const scene = readDoc(doc).def;
    game.setPrefabs(session.getPrefabs());
    const report = recording ? game.replay(scene, recording) : game.play(scene, opts);
    if (!report.ok) {
      playRefused(notify, report);
      return false;
    }
    host.setState((s) => ({ ...s, sceneChanged: false }));
    return true;
  }

  function enter(given: PlayOptions | undefined, recording: RunRecording | null): boolean {
    let opts = given;
    if (!playing && prefab.state) {
      // Play is the scene's; a point picked inside the prefab means nothing there.
      closePrefab();
      if (opts?.at) {
        const { at: _at, ...rest } = opts;
        opts = rest;
      }
    }
    if (playing || !launch(opts, recording)) return false;
    binding.setPaused(true);
    playing = true;
    started = opts;
    replayed = recording;
    session.setMode("play");
    presence({ mode: "play" });
    return true;
  }

  return {
    session,
    host,
    prefab,
    projectPeers: projectPeerStore,
    openPrefab,
    closePrefab,
    createVariant,
    editing(open) {
      return open
        ? {
            session: open.isolation.session,
            prefab: {
              id: open.isolation.prefab,
              scene: name,
              onBack: closePrefab,
              onOpen: (id) => void openPrefab(id, open.from, PREFAB_HEADER_SCOPE),
              onCreateVariant: () => void createVariant(open.isolation.prefab),
            },
          }
        : { session, onOpenPrefab: openPrefab };
    },
    play(opts) {
      return enter(opts, null);
    },
    replay(recording) {
      return enter(undefined, recording);
    },
    replaying: () => playing && replayed !== null,
    stop() {
      if (!playing) return;
      playing = false;
      game.stop();
      binding.setPaused(false);
      host.setState((s) => ({ ...s, sceneChanged: false }));
      session.setMode("edit");
      presence({ mode: "edit" });
    },
    restart() {
      if (playing) launch(started, replayed);
    },
    destroy() {
      opening++;
      unsubscribe();
      offPeers();
      offAccess();
      binding.destroy();
      prefab.state?.isolation.close();
      prefab.setState(() => null);
      session.destroy();
      ownSource?.destroy();
      presence({ doc: null, mode: "edit" });
      playing = false;
      game.setMode("play");
    },
  };
}
