import * as Y from "yjs";

import type { EditSceneOp } from "../project/ops";
import type { AssetEntry, AssetId, AssetKey, AssetPath } from "../project/types";
import { pathClash } from "../project/view";
import { makeIssue } from "../scene/issues";
import { applyOps } from "../scene/ops";
import { PREFAB_KIND } from "../scene/prefab";
import type { Prefab, PrefabLibrary, SceneIssue } from "../scene/types";
import {
  applyOpsToDoc,
  type PrefabChange,
  type PrefabDocPlan,
  type PrefabDocWrite,
  type PrefabDocWriter,
} from "./apply";
import { contentMaps, docMeta, isPrefabDoc, readDoc, touchesMaps } from "./convert";
import { randomKey, type KeyGen } from "./keys";
import { appendLog, readLog } from "./log";
import { docToPrefab, prefabPatch, prefabPathNear, prefabToDoc } from "./prefab-doc";
import { actorId } from "./project-apply";
import { writeEntry } from "./project-doc";
import { appendProjectLog } from "./project-log";
import {
  NO_PREFAB_WRITER,
  type PrefabPlan,
  type PrefabWriter,
  type ProjectSession,
} from "./project-session";
import type { DocOrigin } from "./types";

/**
 * Where a scene's prefabs come from: the project's prefab docs, or a
 * library read from files. Everything that resolves instances reads it.
 */
export type PrefabSource = {
  /** Every live prefab the project holds, by id; docs not yet loaded come from their last snapshot or are absent. */
  library(): PrefabLibrary;
  /** Fires after any prefab doc or the registry changes, once per transaction. */
  subscribe(cb: (changed: readonly AssetId[]) => void): () => void;
  /** The prefab's doc, loading it if needed; null when there is none to open. */
  open(id: AssetId): Promise<Y.Doc | null>;
  /** Writes prefab docs for a scene's batches; a read-only source has none. */
  writer?: PrefabDocWriter;
};

const NOOP = () => {};

/** A fixed library: for tests, headless runs and the file paths. It opens no docs and writes nothing. */
export function staticPrefabSource(library: PrefabLibrary = new Map()): PrefabSource {
  return {
    library: () => library,
    subscribe: () => NOOP,
    open: async () => null,
  };
}

/** What a source with no prefabs reads: the default wherever a source is optional. */
export const EMPTY_PREFAB_SOURCE: PrefabSource = staticPrefabSource();

const notify = (listeners: Set<(changed: readonly AssetId[]) => void>, ids: readonly AssetId[]) => {
  if (ids.length === 0) return;
  for (const l of [...listeners]) l(ids);
};

/** A library's ids that differ between two reads. */
function changedIds(a: PrefabLibrary, b: PrefabLibrary, sig: (p: Prefab) => string): AssetId[] {
  const out: AssetId[] = [];
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(id);
    const y = b.get(id);
    if (!x || !y || sig(x) !== sig(y)) out.push(id);
  }
  return out.sort();
}

const sigOf = (p: Prefab) => JSON.stringify(p);

// ─── In memory ───────────────────────────────────────────

/**
 * Prefab docs held in this process only, seeded from `library`: for tests,
 * headless runs and tools with no project. Its writer patches, creates and
 * drops those docs at once; nothing is shared with anyone.
 */
export function localPrefabSource(
  library: PrefabLibrary = new Map(),
  opts: { key?: KeyGen } = {},
): PrefabSource & { docs(): ReadonlyMap<AssetId, Y.Doc> } {
  const key = opts.key ?? randomKey;
  const docs = new Map<AssetId, Y.Doc>();
  const listeners = new Set<(changed: readonly AssetId[]) => void>();
  let cached: PrefabLibrary | null = null;

  const watch = (id: AssetId, doc: Y.Doc) => {
    const maps = contentMaps(doc);
    doc.on("afterTransaction", (tr: Y.Transaction) => {
      if (!touchesMaps(tr, maps) || docs.get(id) !== doc) return;
      cached = null;
      notify(listeners, [id]);
    });
  };
  const add = (prefab: Prefab) => {
    const doc = prefabToDoc(prefab, { key });
    docs.set(prefab.id, doc);
    watch(prefab.id, doc);
  };
  for (const prefab of library.values()) add(prefab);

  const read = (): PrefabLibrary => {
    if (cached) return cached;
    const out = new Map<string, Prefab>();
    for (const id of [...docs.keys()].sort()) out.set(id, { ...docToPrefab(docs.get(id)!), id });
    return (cached = out);
  };

  const writer: PrefabDocWriter = {
    plan(change) {
      return {
        ok: true,
        write(origin, { label }) {
          const writes: PrefabDocWrite[] = [];
          const gone: AssetId[] = [];
          for (const id of change.changed) {
            const next = change.next.get(id);
            const doc = docs.get(id);
            if (!next) {
              if (doc) {
                docs.delete(id);
                gone.push(id);
              }
              continue;
            }
            if (!doc) {
              add({ ...next, id });
              gone.push(id);
              continue;
            }
            const entry = prefabPatch(doc, { ...next, id }, origin, { key, label });
            if (entry) writes.push({ doc: `prefab:${id}`, entry: entry.id });
          }
          if (gone.length > 0) {
            cached = null;
            notify(listeners, gone);
          }
          return writes;
        },
      };
    },
  };

  return {
    library: read,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    open: async (id) => docs.get(id) ?? null,
    writer,
    docs: () => docs,
  };
}

// ─── Over a project session ──────────────────────────────

export type SessionPrefabSourceOptions = {
  /** The scene the source's writer works for: new prefabs go under its folder's `prefabs/`. */
  scene?: AssetId;
};

/** A prefab source over a project session's prefab docs. */
export type SessionPrefabSource = PrefabSource & {
  writer: PrefabDocWriter;
  readonly session: ProjectSession;
  /** The prefab's doc name in the session, or null when the project holds no such prefab. */
  docName(id: AssetId): string | null;
  /** Resolves once every live prefab's doc is open. */
  ready(): Promise<void>;
  /** Stops this source's listeners; the docs stay with the session. */
  destroy(): void;
};

type Held = { name: string; doc: Y.Doc; off: () => void };

/** One per session: the prefab docs it holds open and what was last read from them. */
type Core = {
  library(): PrefabLibrary;
  listeners: Set<(changed: readonly AssetId[]) => void>;
  load(key: AssetKey): Promise<Held | null>;
  held: Map<AssetKey, Held>;
  ready(): Promise<void>;
  /** New prefabs this client created, written to their docs once those open. */
  pending: Map<AssetKey, { prefab: Prefab; origin: DocOrigin; label: string }>;
  touch(): void;
};

const cores = new WeakMap<ProjectSession, Core>();

const livePrefabs = (session: ProjectSession): AssetEntry[] =>
  [...session.view().byId.values()].filter((e) => e.kind === PREFAB_KIND);

/** A transaction origin that names `origin` in the log but isn't tracked by undo. */
const untracked = (origin: DocOrigin): DocOrigin => ({ ...origin });

function coreOf(session: ProjectSession): Core {
  const existing = cores.get(session);
  if (existing) return existing;
  const held = new Map<AssetKey, Held>();
  const loading = new Map<AssetKey, Promise<Held | null>>();
  const snapshots = new Map<AssetKey, Prefab>();
  const pending: Core["pending"] = new Map();
  const listeners = new Set<(changed: readonly AssetId[]) => void>();
  let cached: PrefabLibrary | null = null;
  let destroyed = false;

  function read(): PrefabLibrary {
    if (cached) return cached;
    const out = new Map<string, Prefab>();
    for (const entry of livePrefabs(session).sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const h = held.get(entry.key);
      const value =
        h && docMeta(h.doc) && isPrefabDoc(h.doc)
          ? docToPrefab(h.doc)
          : (pending.get(entry.key)?.prefab ?? snapshots.get(entry.key));
      if (!value) continue;
      snapshots.set(entry.key, value);
      out.set(entry.id, { ...value, id: entry.id });
    }
    return (cached = out);
  }

  /** Re-reads after any change and tells listeners which ids differ. */
  function touch(): void {
    const before = cached ?? read();
    cached = null;
    notify(listeners, changedIds(before, read(), sigOf));
  }

  function seed(key: AssetKey, h: Held): void {
    const p = pending.get(key);
    if (!p || docMeta(h.doc)) return;
    pending.delete(key);
    const origin = untracked(p.origin);
    h.doc.transact(() => {
      prefabToDoc(p.prefab, {
        doc: h.doc,
        key: session.key,
        project: session.project,
        assetKey: key,
      });
      appendLog(h.doc, { actor: p.origin, label: p.label, keys: [], ops: ["createPrefab"] });
    }, origin);
  }

  async function load(key: AssetKey): Promise<Held | null> {
    const have = held.get(key);
    if (have) return have;
    const already = loading.get(key);
    if (already) return already;
    const entry = session.state().assets[key];
    const name = entry && session.docNameFor(entry);
    if (!name) return null;
    const run = (async () => {
      const handle = await session.open(name);
      if (destroyed || !isLive(key)) {
        session.release(name);
        return null;
      }
      const maps = contentMaps(handle.doc);
      const onTransaction = (tr: Y.Transaction) => {
        if (touchesMaps(tr, maps) || tr.changed.has(handle.doc.getMap("meta") as never)) touch();
      };
      handle.doc.on("afterTransaction", onTransaction);
      const h: Held = {
        name,
        doc: handle.doc,
        off: () => handle.doc.off("afterTransaction", onTransaction),
      };
      held.set(key, h);
      seed(key, h);
      touch();
      return h;
    })();
    loading.set(key, run);
    const done = () => loading.delete(key);
    run.then(done, done);
    return run;
  }

  const isLive = (key: AssetKey) => {
    const entry = session.state().assets[key];
    return entry !== undefined && !entry.deleted && entry.kind === PREFAB_KIND;
  };

  /** Opens new live prefabs' docs and lets go of those no longer live. */
  function sync(): void {
    if (destroyed) return;
    for (const entry of livePrefabs(session))
      if (!held.has(entry.key)) void load(entry.key).catch(() => {});
    for (const [key, h] of [...held])
      if (!isLive(key)) {
        h.off();
        held.delete(key);
        session.release(h.name);
      }
    touch();
  }

  const onProject = () => sync();
  session.projectDoc.on("afterTransaction", onProject);
  const offSession = session.subscribe((e) => {
    if (e.type !== "close") return;
    for (const [key, h] of held)
      if (h.name === e.doc) {
        h.off();
        held.delete(key);
      }
  });
  session.projectDoc.on("destroy", () => {
    destroyed = true;
    offSession();
  });

  const core: Core = {
    library: read,
    listeners,
    load,
    held,
    pending,
    touch,
    async ready() {
      await Promise.all(livePrefabs(session).map((e) => load(e.key).catch(() => null)));
    },
  };
  cores.set(session, core);
  session.prefabLibrary = read;
  sync();
  return core;
}

type WriterOptions = SessionPrefabSourceOptions & {
  /** Append a project log entry when the batch wrote two or more docs; a caller that logs its own passes false. */
  projectLog?: boolean;
};

/**
 * The writer behind a session's prefab docs: each changed prefab's doc is
 * patched in a transaction of its own, a new prefab becomes a registry
 * entry under the scene's folder's `prefabs/` (its doc is seeded as soon as
 * it opens), and a removed one goes to the trash.
 */
function docsWriter(session: ProjectSession, core: Core, opts: WriterOptions): PrefabDocWriter {
  return {
    plan(change: PrefabChange): PrefabDocPlan {
      const view = session.view();
      const scene = opts.scene === undefined ? undefined : view.byId.get(opts.scene);
      const patches: { held: Held; prefab: Prefab }[] = [];
      const created: { key: AssetKey; id: AssetId; path: AssetPath; prefab: Prefab }[] = [];
      const removed: AssetEntry[] = [];
      const fail = (issue: SceneIssue): PrefabDocPlan => ({ ok: false, issue });
      for (const id of change.changed) {
        const next = change.next.get(id);
        const entry = view.byId.get(id);
        if (entry && entry.kind !== PREFAB_KIND)
          return fail(
            makeIssue("asset-id-taken", {
              message: `"${id}" is already the id of a ${entry.kind} in this project; a prefab needs an id of its own`,
              entityIds: [id],
            }),
          );
        if (next && entry) {
          const held = core.held.get(entry.key);
          if (!held)
            return fail(
              makeIssue("op-invalid", {
                message: `prefab "${id}"'s doc isn't open yet; wait for the project's prefabs to load and try again`,
                entityIds: [id],
              }),
            );
          patches.push({ held, prefab: { ...next, id } });
        } else if (next) {
          let key = id;
          for (let n = 2; session.state().assets[key]; n++) key = `${id}-${n}`;
          created.push({ key, id, path: prefabPathNear(id, scene?.path), prefab: { ...next, id } });
        } else if (entry) removed.push(entry);
      }
      const gone = new Set(removed.map((e) => e.key));
      const holders: Pick<AssetEntry, "key" | "id" | "path">[] = Object.values(
        session.state().assets,
      ).filter((e) => !gone.has(e.key));
      for (const c of created) {
        const clash = pathClash(holders, c.path);
        if (clash)
          return fail(
            makeIssue("path-taken", {
              message: `prefab "${c.id}" goes to ${c.path}, but ${clash.message}`,
              entityIds: [c.id, clash.entry.id],
              got: c.path,
            }),
          );
        holders.push(c);
      }
      return {
        ok: true,
        write(origin, { label, scene: sceneEntry }) {
          const writes: PrefabDocWrite[] = [];
          for (const { held, prefab } of patches) {
            const entry = prefabPatch(held.doc, prefab, origin, { key: session.key, label });
            if (entry) writes.push({ doc: held.name, entry: entry.id });
          }
          const registry = created.length > 0 || removed.length > 0;
          const sceneDoc = scene ? session.docNameFor(scene) : null;
          const docs = [
            ...(sceneEntry && sceneDoc ? [{ doc: sceneDoc, entry: sceneEntry.id }] : []),
            ...writes,
          ];
          const logProject = opts.projectLog !== false && docs.length + (registry ? 1 : 0) > 1;
          if (!registry && !logProject) return writes;
          const at = session.now();
          const by = actorId(origin);
          for (const c of created) core.pending.set(c.key, { prefab: c.prefab, origin, label });
          const id = randomKey();
          session.projectDoc.transact(() => {
            const state = session.state();
            for (const c of created)
              writeEntry(session.projectDoc, {
                key: c.key,
                id: c.id,
                kind: PREFAB_KIND,
                path: c.path,
                created: { at, by },
              });
            for (const entry of removed) {
              const current = state.assets[entry.key];
              if (current && !current.deleted)
                writeEntry(session.projectDoc, { ...current, deleted: { at, by } });
            }
            if (logProject)
              appendProjectLog(session.projectDoc, {
                id,
                actor: origin,
                label,
                at,
                docs: [...docs, ...(registry ? [{ doc: session.name, entry: id }] : [])],
              });
          }, origin);
          return writes;
        },
      };
    },
  };
}

/** Waits for `name` to open in the session and holds it; `release` lets go once. */
async function hold(session: ProjectSession, name: string): Promise<() => void> {
  await session.open(name);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    session.release(name);
  };
}

/**
 * The session's slot filled: plans an `editScene` that holds prefab ops (on
 * a scene) or targets a prefab, against the docs as they are, and writes
 * them through `applyOpsToDoc` with the docs writer when the batch writes.
 */
function sessionWriter(core: Core): PrefabWriter {
  return {
    async plan({ session, op, entry }): Promise<PrefabPlan> {
      await core.ready();
      const name = session.docNameFor(entry);
      if (!name)
        return {
          ok: false,
          issue: makeIssue("asset-kind", {
            message: `"${entry.id}" is a ${entry.kind}, which has no doc to edit`,
            entityIds: [entry.id],
          }),
        };
      const release = await hold(session, name);
      const doc = session.get(name)!.doc;
      const fail = (issue: SceneIssue): PrefabPlan => {
        release();
        return { ok: false, issue };
      };
      const batch = { ops: (op as EditSceneOp).ops, label: `Edit ${entry.id}` };
      const writer = docsWriter(session, core, { scene: entry.id, projectLog: false });
      const view = readDoc(doc, { registry: session.registry });
      if (view.kind === "scene") {
        const library = core.library();
        const dry = applyOps(view.def, batch, session.registry, {
          prefabs: library,
          validate: "none",
        });
        if (!dry.ok) return fail(dry.issue);
        if (dry.prefabsChanged && dry.prefabs) {
          const planned = writer.plan({
            prev: library,
            next: dry.prefabs,
            changed: dry.prefabsChanged,
          });
          if (!planned.ok) return fail(planned.issue);
        }
      } else {
        // A prefab doc's own refusals (scene-only ops, grouped children) are applyOpsToDoc's; try it on a copy.
        const copy = new Y.Doc();
        Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
        const dry = applyOpsToDoc(copy, batch, session.origin, session.registry, { noLog: true });
        copy.destroy();
        if (!dry.ok) return fail(dry.issue);
      }
      return {
        ok: true,
        docs: [name],
        release,
        write(origin) {
          const result = applyOpsToDoc(doc, batch, origin, session.registry, {
            key: session.key,
            prefabs: core.library(),
            prefabWriter: writer,
          });
          if (!result.ok)
            throw new Error(
              `editScene on "${entry.id}" changed under the batch: ${result.issue.message}`,
            );
          const own = result.keys.length > 0 ? [{ doc: name, entry: readLog(doc).at(-1)!.id }] : [];
          return [...own, ...result.docs];
        },
      };
    },
  };
}

/**
 * The project's prefabs as a source: every live prefab's doc, opened
 * through the session and held while it is live, read as a library;
 * `subscribe` fires once per transaction in any of them or the registry.
 * The first source for a session also fills its `prefabLibrary` slot, and
 * its `prefabWriter` slot when nothing else has, so `applyProjectBatch`
 * resolves instances against these docs and writes prefab ops to them.
 */
export function sessionPrefabSource(
  session: ProjectSession,
  opts: SessionPrefabSourceOptions = {},
): SessionPrefabSource {
  const core = coreOf(session);
  if (session.prefabWriter === NO_PREFAB_WRITER) session.prefabWriter = sessionWriter(core);
  const mine = new Set<(changed: readonly AssetId[]) => void>();
  const entryOf = (id: AssetId) => {
    const entry = session.view().byId.get(id);
    return entry?.kind === PREFAB_KIND ? entry : undefined;
  };
  return {
    session,
    library: () => core.library(),
    subscribe(cb) {
      mine.add(cb);
      core.listeners.add(cb);
      return () => {
        mine.delete(cb);
        core.listeners.delete(cb);
      };
    },
    async open(id) {
      const entry = entryOf(id);
      if (!entry) return null;
      return (await core.load(entry.key))?.doc ?? null;
    },
    docName(id) {
      const entry = entryOf(id);
      return entry ? session.docNameFor(entry) : null;
    },
    ready: () => core.ready(),
    writer: docsWriter(session, core, opts),
    destroy() {
      for (const cb of mine) core.listeners.delete(cb);
      mine.clear();
    },
  };
}
