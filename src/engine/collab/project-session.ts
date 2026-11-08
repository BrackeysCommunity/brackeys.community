import * as Y from "yjs";

import { createRegistry } from "../game/define";
import type { Registry } from "../game/types";
import type { ContentStore } from "../project/content-store";
import { docNameOf, parseDocName } from "../project/doc-names";
import type { DocLayout, KindRegistry } from "../project/kinds";
import type { EditSceneOp } from "../project/ops";
import type {
  AssetEntry,
  AssetKey,
  AssetKindName,
  BuildStamp,
  ProjectId,
  ProjectState,
  ProjectView,
  Sha256,
} from "../project/types";
import { projectView } from "../project/view";
import { makeIssue } from "../scene/issues";
import type { PrefabLibrary, SceneIssue } from "../scene/types";
import { ENGINE_VERSION } from "../version";
import { buildAtFrom, stampWins } from "./build-stamp";
import { randomKey, type KeyGen } from "./keys";
import { CONTENT_MAP } from "./layout";
import { appendLog } from "./log";
import { PREFAB_HEADER_KEY } from "./prefab-doc";
import { projectBuildMap, readProject } from "./project-doc";
import { appendProjectLog } from "./project-log";
import { contentLogKey } from "./revert";
import {
  ASSETS_KEY,
  DOC_MAPS,
  GROUP_KEY_PREFIX,
  INSTANCE_KEY_PREFIX,
  PARAM_KEY_PREFIX,
  PREFAB_KEY_PREFIX,
  SCENE_KEY,
  SETTINGS_KEY,
  VARIANT_KEY,
  type AwarenessLike,
  type DocOrigin,
  type LogEntry,
} from "./types";
import {
  createUndoCoordinator,
  type StepSelection,
  type UndoCoordinator,
  type UndoneStep,
} from "./undo-coordinator";

/** One doc as the host's provider hands it over: synced, with its awareness, and how to let it go. */
export type OpenedDoc = { doc: Y.Doc; awareness: AwarenessLike; close(): void };

/** Opens a doc by name (`project:…`, `scene:…`, `asset:…`); resolves once it holds the server's state. */
export type OpenDoc = (name: string) => Promise<OpenedDoc>;

/** `code-skew`, with the two schema hashes that differ. */
export type CodeSkewIssue = SceneIssue & {
  code: "code-skew";
  detail: { kind: AssetKindName; mine: Sha256; project: Sha256 };
};

/** A doc the session holds open. `readOnly` and `issue` follow the project's build stamps. */
export type SessionDoc = {
  readonly name: string;
  readonly doc: Y.Doc;
  readonly awareness: AwarenessLike;
  /** The registry key behind the doc; null for the project doc. */
  readonly key: AssetKey | null;
  /** The asset kind; null for the project doc or a key the registry doesn't hold. */
  readonly kind: AssetKindName | null;
  /** A declarative kind's layout; absent for the project doc, scenes and prefabs. */
  readonly layout?: DocLayout;
  /** This build's schema for the kind differs from a newer build's: the doc may be read, not written. */
  readonly readOnly: boolean;
  readonly issue?: CodeSkewIssue;
};

/** What a prefab writer is asked to plan: an `editScene` that targets a prefab or holds a prefab op. */
export type PrefabWriteRequest = {
  session: ProjectSession;
  op: EditSceneOp;
  /** The op's index in its batch. */
  index: number;
  entry: AssetEntry;
};

/**
 * A planned prefab write, checked against plain JSON before anything is
 * written. `write` runs while the batch writes its docs, one transaction
 * per doc, and returns each doc it wrote with that doc's own log entry id.
 * `release` lets go of the docs the plan opened, once the batch is done.
 */
export type PrefabPlan =
  | {
      ok: true;
      docs: readonly string[];
      write(origin: DocOrigin): { doc: string; entry: string }[];
      release?(): void;
    }
  | { ok: false; issue: SceneIssue };

/** Writes the prefab docs a batch's `editScene` ops change; the session's slot for it. */
export type PrefabWriter = {
  plan(request: PrefabWriteRequest): Promise<PrefabPlan>;
};

/**
 * The writer a session starts with: it refuses every prefab write. The
 * first `sessionPrefabSource` over the session replaces it with one that
 * writes the project's prefab docs.
 */
export const NO_PREFAB_WRITER: PrefabWriter = {
  async plan({ op, entry }) {
    return {
      ok: false,
      issue: makeIssue("op-invalid", {
        message: `"${entry.id}": ${op.op === "editScene" && entry.kind === "prefab" ? "editing a prefab" : "a prefab op"} writes prefab docs, which needs the project`,
        entityIds: [entry.id],
      }),
    };
  },
};

export type ProjectSessionOptions = {
  project: ProjectId;
  /** The host's provider; the engine never opens a connection itself. */
  openDoc: OpenDoc;
  /** This client's origin. Undo tracks this object: pass the same one to every write. */
  origin: DocOrigin;
  registry: Registry;
  kinds: KindRegistry;
  /** Where blob ops' bytes are read for inspection. */
  store?: ContentStore;
  /** When this build was made, ms since the epoch; the newest build's schema stamps win. Default 0. */
  buildAt?: number;
  /** Writes prefab docs; default `NO_PREFAB_WRITER` until a `sessionPrefabSource` fills the slot. */
  prefabWriter?: PrefabWriter;
  /** Undo steps kept; default `UNDO_CAP`. */
  cap?: number;
  /** Registry keys and doc item keys for new things; default `randomKey`. */
  key?: KeyGen;
  /** The clock batches stamp; default `Date.now`. */
  now?: () => number;
};

export type ProjectSessionEvent =
  /** The undo stacks changed. */
  | { type: "history" }
  /** A doc became read-only or writable. */
  | { type: "access"; doc: string; readOnly: boolean; issue?: CodeSkewIssue }
  | { type: "open" | "close"; doc: string };

export type ProjectSession = {
  readonly project: ProjectId;
  /** The project doc's name. */
  readonly name: string;
  readonly origin: DocOrigin;
  readonly registry: Registry;
  readonly kinds: KindRegistry;
  readonly store?: ContentStore;
  readonly buildAt: number;
  readonly projectDoc: Y.Doc;
  readonly awareness: AwarenessLike;
  readonly coordinator: UndoCoordinator;
  /** Writes prefab docs for `editScene`; replace it to give the session prefab docs. */
  prefabWriter: PrefabWriter;
  /** The prefabs a batch's instances resolve against; empty until a `sessionPrefabSource` fills the slot. */
  prefabLibrary: () => PrefabLibrary;
  readonly key: KeyGen;
  now(): number;
  /** This build's per-kind schema hashes. */
  readonly hashes: Readonly<Record<AssetKindName, Sha256>>;
  state(): ProjectState;
  view(): ProjectView;
  /** The doc a registry entry's content lives in; null for blob and code kinds. */
  docNameFor(entry: AssetEntry): string | null;
  /** Opens a doc, or holds an open one once more; each `open` wants one `release`. */
  open(name: string): Promise<SessionDoc>;
  /** Lets go of one `open`; the doc closes when nothing holds it and no undo step names it. */
  release(name: string): void;
  /** An open doc, or undefined. */
  get(name: string): SessionDoc | undefined;
  /** The open docs' names, the project doc first. */
  openDocs(): readonly string[];
  /** Docs with steps on the undo stacks: they stay open while the session lives. */
  pinned(): readonly string[];
  /** Every open doc this build may only read. */
  skew(): readonly CodeSkewIssue[];
  /** The `code-skew` a write to a doc of `kind` meets now, or null when this build may write it. */
  skewFor(kind: AssetKindName): CodeSkewIssue | null;
  /** Ends one undo step; see `UndoCoordinator.commit`. */
  commit(step: { docs: string[]; label: string; selection?: StepSelection }): void;
  /** Undoes this client's last step wherever it was; the step names its docs, so a host can say where. */
  undo(): UndoneStep | null;
  redo(): UndoneStep | null;
  canUndo(): boolean;
  canRedo(): boolean;
  undoLabel(): string | undefined;
  redoLabel(): string | undefined;
  subscribe(listener: (e: ProjectSessionEvent) => void): () => void;
  /** Closes every doc and drops the undo stacks. */
  destroy(): void;
};

/**
 * The schema hashes a build stamps and code skew compares: each kind's
 * schema under the game's code alone. A project's material assets are
 * content, so a registry carrying them hashes as its game's does.
 */
export function buildHashes(
  kinds: KindRegistry,
  registry: Registry,
): Promise<Readonly<Record<AssetKindName, Sha256>>> {
  return kinds.schemaHashes({ registry: createRegistry(registry.game), project: null });
}

const isStamp = (v: unknown): v is BuildStamp =>
  v !== null &&
  typeof v === "object" &&
  typeof (v as BuildStamp).hash === "string" &&
  typeof (v as BuildStamp).buildAt === "number";

/** `doc` names the doc it stops; without one the issue is about creating a doc of `kind`. */
function skewIssue(
  kind: AssetKindName,
  mine: Sha256,
  project: Sha256,
  doc?: string,
): CodeSkewIssue {
  return {
    ...makeIssue("code-skew", {
      message: `This build can only read ${doc ?? `${kind} docs`}: a newer build of the game changed the ${kind} schema.`,
      entityIds: doc ? [doc] : [],
    }),
    code: "code-skew",
    detail: { kind, mine, project },
  };
}

type Held = { handle: SessionDoc & { readOnly: boolean; issue?: CodeSkewIssue }; uses: number };

/** The origin an undo's or redo's history rows are written with: no undo manager tracks it, so undo never takes them back. */
const HISTORY_ORIGIN = Symbol("undo-history");

/** How a doc's log names an entry of one of its root maps; null for roots the log doesn't name. */
function logKeyOf(root: string, key: string): string | null {
  switch (root) {
    case DOC_MAPS.entities:
      return key;
    case DOC_MAPS.instances:
      return `${INSTANCE_KEY_PREFIX}${key}`;
    case DOC_MAPS.groups:
      return `${GROUP_KEY_PREFIX}${key}`;
    case DOC_MAPS.prefabs:
      return `${PREFAB_KEY_PREFIX}${key}`;
    case DOC_MAPS.settings:
      return SETTINGS_KEY;
    case DOC_MAPS.scene:
      return SCENE_KEY;
    case DOC_MAPS.prefab:
      return key === "base" ? VARIANT_KEY : PREFAB_HEADER_KEY;
    case DOC_MAPS.assets:
      return ASSETS_KEY;
    case DOC_MAPS.params:
      return `${PARAM_KEY_PREFIX}${key}`;
    case DOC_MAPS.overrides:
      return VARIANT_KEY;
    case CONTENT_MAP:
      return contentLogKey(key);
    default:
      return null;
  }
}

/** Adds the log keys of every root-map entry `tr` changed in `doc` to `into`. */
function collectLogKeys(doc: Y.Doc, tr: Y.Transaction, into: Set<string>): void {
  for (const [type, subs] of tr.changed) {
    let root = type;
    let top: string | null = null;
    while (root._item) {
      top = root._item.parentSub;
      root = root._item.parent as typeof type;
    }
    let rootName: string | undefined;
    for (const [n, t] of doc.share) if (t === root) rootName = n;
    if (rootName === undefined) continue;
    const keys = top !== null ? [top] : [...subs].filter((k): k is string => k !== null);
    for (const k of keys) {
      const logKey = logKeyOf(rootName, k);
      if (logKey !== null) into.add(logKey);
    }
  }
}

/**
 * A client's live project: the project doc, the docs it opens through the
 * host's `openDoc` (lazily, each once), one undo coordinator over all of
 * them, and code-skew checks against the project's build stamps. A doc of a
 * kind whose schema hash differs from the project's stamp opens read-only,
 * unless this build is newer, in which case this client writes its stamp
 * (origin `repair`, reason `build`) and every older client turns read-only.
 */
export async function createProjectSession(opts: ProjectSessionOptions): Promise<ProjectSession> {
  const name = docNameOf({ kind: "project", project: opts.project });
  const hashes = await buildHashes(opts.kinds, opts.registry);
  const root = await opts.openDoc(name);
  const buildAt = buildAtFrom(opts.buildAt);
  const key = opts.key ?? randomKey;
  const now = opts.now ?? Date.now;
  const repair: DocOrigin = { kind: "repair", reason: "build" };
  const coordinator = createUndoCoordinator(
    opts.origin,
    opts.cap === undefined ? {} : { cap: opts.cap },
  );
  const listeners = new Set<(e: ProjectSessionEvent) => void>();
  const emit = (e: ProjectSessionEvent) => {
    for (const l of listeners) l(e);
  };

  const held = new Map<string, Held>();
  const closers = new Map<string, () => void>();
  const opening = new Map<string, Promise<SessionDoc>>();
  let destroyed = false;

  held.set(name, {
    handle: {
      name,
      doc: root.doc,
      awareness: root.awareness,
      key: null,
      kind: null,
      readOnly: false,
    },
    uses: Number.POSITIVE_INFINITY,
  });
  closers.set(name, () => root.close());
  coordinator.attach(name, root.doc);

  const state = () => readProject(root.doc);
  const view = () => projectView(state(), opts.kinds);

  /** Where this build stands on a kind: in step with the stamp, due to write its own, or behind it. */
  function standing(
    kind: AssetKindName,
  ):
    | { at: "current" }
    | { at: "ahead"; mine: Sha256 }
    | { at: "behind"; mine: Sha256; project: Sha256 } {
    const mine = hashes[kind];
    if (mine === undefined) return { at: "current" };
    const raw = projectBuildMap(root.doc).get(kind);
    const stamp = isStamp(raw) ? raw : undefined;
    if (stamp?.hash === mine) return { at: "current" };
    if (!stamp || stampWins(buildAt, mine, stamp)) return { at: "ahead", mine };
    return { at: "behind", mine, project: stamp.hash };
  }

  const settled = () => root.doc.store.pendingStructs === null && root.doc.store.pendingDs === null;
  /** A stamp this build held back while updates waited on missing ones; written once they land. */
  let heldBack = false;

  /** Settles one doc's access against the build map, writing this build's stamp when it should win. */
  function judge(h: Held): void {
    const kind = h.handle.kind;
    if (kind === null) return;
    const now = standing(kind);
    if (now.at === "ahead") {
      // A stamp read while updates wait on missing ones may be stale.
      if (settled())
        root.doc.transact(
          () =>
            projectBuildMap(root.doc).set(kind, {
              hash: now.mine,
              buildAt,
              engine: ENGINE_VERSION,
            }),
          repair,
        );
      else heldBack = true;
    }
    const issue =
      now.at === "behind" ? skewIssue(kind, now.mine, now.project, h.handle.name) : undefined;
    const readOnly = issue !== undefined;
    if (readOnly === h.handle.readOnly && issue?.detail.project === h.handle.issue?.detail.project)
      return;
    h.handle.readOnly = readOnly;
    if (issue) h.handle.issue = issue;
    else delete h.handle.issue;
    emit({ type: "access", doc: h.handle.name, readOnly, ...(issue ? { issue } : {}) });
  }

  const onBuild = () => {
    for (const h of held.values()) judge(h);
  };
  projectBuildMap(root.doc).observe(onBuild);
  // The updates a held-back stamp waited on may not touch the build map, so check after every transaction.
  const onSettled = () => {
    if (!heldBack || !settled()) return;
    heldBack = false;
    onBuild();
  };
  root.doc.on("afterAllTransactions", onSettled);

  async function load(docName: string): Promise<SessionDoc> {
    const parsed = parseDocName(docName);
    if (!parsed || parsed.project !== opts.project || parsed.kind === "project")
      throw new Error(`ProjectSession: "${docName}" isn't a doc of project "${opts.project}"`);
    const opened = await opts.openDoc(docName);
    if (destroyed) {
      opened.close();
      throw new Error("ProjectSession: destroyed while opening a doc");
    }
    const entry = state().assets[parsed.key];
    const def = entry ? opts.kinds.get(entry.kind) : undefined;
    const layout =
      def?.storage === "doc" && def.layout !== "custom" ? (def.layout as DocLayout) : undefined;
    const h: Held = {
      handle: {
        name: docName,
        doc: opened.doc,
        awareness: opened.awareness,
        key: parsed.key,
        kind: entry?.kind ?? null,
        ...(layout ? { layout } : {}),
        readOnly: false,
      },
      uses: 0,
    };
    held.set(docName, h);
    closers.set(docName, () => opened.close());
    coordinator.attach(docName, opened.doc);
    judge(h);
    emit({ type: "open", doc: docName });
    return h.handle;
  }

  function close(docName: string): void {
    coordinator.detach(docName);
    held.delete(docName);
    closers.get(docName)?.();
    closers.delete(docName);
    emit({ type: "close", doc: docName });
  }

  /** Closes the docs nothing holds and no undo step names. */
  function sweep(): void {
    const pinned = new Set(coordinator.pinned());
    for (const [docName, h] of [...held]) if (h.uses <= 0 && !pinned.has(docName)) close(docName);
  }

  /**
   * Undoes or redoes the top step, then records it as history: each doc it
   * changed gets a log entry of kind `how` naming the keys it reverted, and
   * a step over two or more docs (or the registry) one project log entry.
   */
  function step(how: "undo" | "redo"): UndoneStep | null {
    const keys = new Map<string, Set<string>>();
    const unwatch: (() => void)[] = [];
    for (const [docName, h] of held) {
      if (docName === name) continue;
      const doc = h.handle.doc;
      const watch = (tr: Y.Transaction) => {
        if (!(tr.origin instanceof Y.UndoManager)) return;
        let into = keys.get(docName);
        if (!into) keys.set(docName, (into = new Set()));
        collectLogKeys(doc, tr, into);
      };
      doc.on("afterTransaction", watch);
      unwatch.push(() => doc.off("afterTransaction", watch));
    }
    let done: UndoneStep | null;
    try {
      done = how === "undo" ? coordinator.undo() : coordinator.redo();
    } finally {
      for (const off of unwatch) off();
    }
    if (done) logStep(done, how, keys);
    sweep();
    emit({ type: "history" });
    return done;
  }

  function logStep(
    done: UndoneStep,
    how: "undo" | "redo",
    keys: ReadonlyMap<string, ReadonlySet<string>>,
  ): void {
    const label = `${how === "undo" ? "Undo" : "Redo"} ${done.label}`;
    const at = now();
    const docs: { doc: string; entry: string }[] = [];
    let self: string | null = null;
    for (const docName of done.docs) {
      if (docName === name) {
        self = randomKey();
        docs.push({ doc: name, entry: self });
        continue;
      }
      const doc = held.get(docName)?.handle.doc;
      if (!doc) continue;
      let logged: LogEntry | undefined;
      doc.transact(() => {
        logged = appendLog(doc, {
          actor: opts.origin,
          label,
          at,
          keys: [...(keys.get(docName) ?? [])],
          kind: how,
        });
      }, HISTORY_ORIGIN);
      docs.push({ doc: docName, entry: logged!.id });
    }
    if (self === null && docs.length < 2) return;
    root.doc.transact(
      () =>
        appendProjectLog(root.doc, {
          ...(self === null ? {} : { id: self }),
          actor: opts.origin,
          label,
          at,
          docs,
        }),
      HISTORY_ORIGIN,
    );
  }

  const session: ProjectSession = {
    project: opts.project,
    name,
    origin: opts.origin,
    registry: opts.registry,
    kinds: opts.kinds,
    ...(opts.store ? { store: opts.store } : {}),
    buildAt,
    projectDoc: root.doc,
    awareness: root.awareness,
    coordinator,
    prefabWriter: opts.prefabWriter ?? NO_PREFAB_WRITER,
    prefabLibrary: () => new Map(),
    key,
    now,
    hashes,
    state,
    view,
    docNameFor(entry) {
      const def = opts.kinds.get(entry.kind);
      if (def?.storage !== "doc") return null;
      return docNameOf({ kind: def.prefix ?? "asset", project: opts.project, key: entry.key });
    },
    async open(docName) {
      if (destroyed) throw new Error("ProjectSession: destroyed");
      const current = held.get(docName);
      if (current) {
        current.uses++;
        return current.handle;
      }
      let pending = opening.get(docName);
      if (!pending) {
        pending = load(docName);
        opening.set(docName, pending);
        const done = () => opening.delete(docName);
        pending.then(done, done);
      }
      const handle = await pending;
      const h = held.get(docName);
      if (!h) throw new Error(`ProjectSession: "${docName}" closed while opening`);
      h.uses++;
      return handle;
    },
    release(docName) {
      const h = held.get(docName);
      if (!h || docName === name) return;
      h.uses = Math.max(0, h.uses - 1);
      sweep();
    },
    get: (docName) => held.get(docName)?.handle,
    openDocs: () => [...held.keys()],
    pinned: () => coordinator.pinned(),
    skewFor(kind) {
      const now = standing(kind);
      return now.at === "behind" ? skewIssue(kind, now.mine, now.project) : null;
    },
    skew() {
      const out: CodeSkewIssue[] = [];
      for (const h of held.values()) if (h.handle.issue) out.push(h.handle.issue);
      return out;
    },
    commit(step) {
      coordinator.commit(step);
      sweep();
      emit({ type: "history" });
    },
    undo: () => step("undo"),
    redo: () => step("redo"),
    canUndo: () => coordinator.canUndo(),
    canRedo: () => coordinator.canRedo(),
    undoLabel: () => coordinator.undoLabel(),
    redoLabel: () => coordinator.redoLabel(),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      projectBuildMap(root.doc).unobserve(onBuild);
      root.doc.off("afterAllTransactions", onSettled);
      coordinator.destroy();
      for (const docName of [...held.keys()].reverse()) {
        held.delete(docName);
        closers.get(docName)?.();
      }
      closers.clear();
      listeners.clear();
    },
  };
  return session;
}

// ─── An in-process doc host ──────────────────────────────

/** The origin a memory host's updates arrive with. */
const HOST = Symbol("memory-doc-host");

export type MemoryDocClient = {
  openDoc: OpenDoc;
  /** Offline holds this client's updates both ways; back online exchanges state as a reconnect does. */
  setOnline(online: boolean): void;
  /** Every name this client has opened, in order, once per open. */
  readonly opened: readonly string[];
};

export type MemoryDocHost = {
  /** The host's copy of a doc, created empty: seed it before clients open it. */
  doc(name: string): Y.Doc;
  /** A new client, with its own copy of each doc it opens. */
  client(): MemoryDocClient;
};

/**
 * Docs served in-process, for tests, headless runs and tools with no sync
 * server: every client's `openDoc` gets its own copy of the named doc, kept
 * in step with every other copy through the host's, and an awareness shared
 * by the copies of that doc.
 */
export function memoryDocHost(): MemoryDocHost {
  type Copy = { doc: Y.Doc; online: () => boolean };
  type Room = {
    doc: Y.Doc;
    copies: Set<Copy>;
    states: Map<number, Record<string, unknown>>;
    watchers: Set<(...args: unknown[]) => void>;
  };
  const rooms = new Map<string, Room>();

  const room = (docName: string): Room => {
    let r = rooms.get(docName);
    if (r) return r;
    const doc = new Y.Doc();
    const made: Room = { doc, copies: new Set(), states: new Map(), watchers: new Set() };
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      for (const c of made.copies)
        if (c !== origin && c.online()) Y.applyUpdate(c.doc, update, HOST);
    });
    rooms.set(docName, made);
    return made;
  };

  return {
    doc: (docName) => room(docName).doc,
    client() {
      let online = true;
      const opened: string[] = [];
      const mine = new Map<Copy, Room>();
      const pull = (c: Copy, r: Room) =>
        Y.applyUpdate(c.doc, Y.encodeStateAsUpdate(r.doc, Y.encodeStateVector(c.doc)), HOST);
      const push = (c: Copy, r: Room) =>
        Y.applyUpdate(r.doc, Y.encodeStateAsUpdate(c.doc, Y.encodeStateVector(r.doc)), c);
      return {
        opened,
        setOnline(next) {
          if (next === online) return;
          if (!next) {
            online = false;
            return;
          }
          // A provider's sync: take the host's state, send what it lacks, then go live and take
          // what others wrote meanwhile, so no observer acts on a partial state.
          for (const [c, r] of mine) pull(c, r);
          for (const [c, r] of mine) push(c, r);
          online = true;
          for (const [c, r] of mine) pull(c, r);
        },
        async openDoc(docName) {
          opened.push(docName);
          const r = room(docName);
          const doc = new Y.Doc();
          const copy: Copy = { doc, online: () => online };
          Y.applyUpdate(doc, Y.encodeStateAsUpdate(r.doc), HOST);
          const onUpdate = (update: Uint8Array, origin: unknown) => {
            if (origin !== HOST && online) Y.applyUpdate(r.doc, update, copy);
          };
          doc.on("update", onUpdate);
          r.copies.add(copy);
          mine.set(copy, r);
          const notify = () => {
            for (const w of r.watchers) w();
          };
          const local = new Set<(...args: unknown[]) => void>();
          const awareness: AwarenessLike = {
            clientID: doc.clientID,
            getLocalState: () => r.states.get(doc.clientID) ?? null,
            setLocalStateField(field, value) {
              r.states.set(doc.clientID, { ...r.states.get(doc.clientID), [field]: value });
              notify();
            },
            getStates: () => r.states,
            on: (_e, cb) => {
              local.add(cb);
              r.watchers.add(cb);
            },
            off: (_e, cb) => {
              local.delete(cb);
              r.watchers.delete(cb);
            },
          };
          return {
            doc,
            awareness,
            close() {
              doc.off("update", onUpdate);
              r.copies.delete(copy);
              mine.delete(copy);
              for (const cb of local) r.watchers.delete(cb);
              if (r.states.delete(doc.clientID)) notify();
              doc.destroy();
            },
          };
        },
      };
    },
  };
}
