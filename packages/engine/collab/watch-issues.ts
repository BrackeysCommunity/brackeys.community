import type * as Y from "yjs";

import type { Registry } from "../game/types";
import { createKindRegistry, type DocLayout, type KindRegistry } from "../project/kinds";
import { isPlainObject, isRuntimeKind } from "../project/kinds/define";
import { gameSettingsEntries } from "../project/kinds/game-settings";
import { runtimeView, type ProjectRuntimeView } from "../project/runtime-view";
import type { AssetEntry, AssetId, AssetKindName, ProjectView } from "../project/types";
import { makeIssue } from "../scene/issues";
import type { Bounds, SceneIssue } from "../scene/types";
import { validateScene } from "../scene/validate";
import { contentMaps, prefabsReachedBy, readDoc, touchesMaps } from "./convert";
import { layoutFromDoc } from "./layout";
import { EMPTY_PREFAB_SOURCE, type PrefabSource } from "./prefab-source";
import { projectAssetsMap } from "./project-doc";
import type { ProjectSessionEvent } from "./project-session";

export type IssueWatch = {
  /** Validates now, skipping the wait. */
  flush(): SceneIssue[];
  stop(): void;
};

/**
 * The project a doc belongs to, as validation reads it: a `ProjectSession`
 * fits. A change to `projectDoc`'s registry (an asset added, renamed or
 * trashed) revalidates. The project's engine block is the view's `engine`,
 * else the game-settings doc's while `get` has it open; an `anim` block's
 * animation source is read from its doc while `get` has it open. An edit to
 * either doc, or one opening or closing (`subscribe`), revalidates.
 */
export type IssueProject = {
  view(): ProjectView;
  readonly projectDoc?: Y.Doc;
  /** The kinds its docs are read with; default the game's. */
  readonly kinds?: KindRegistry;
  docNameFor?(entry: AssetEntry): string | null;
  get?(name: string): { readonly doc: Y.Doc; readonly layout?: DocLayout } | undefined;
  subscribe?(listener: (e: ProjectSessionEvent) => void): () => void;
};

type EngineBlock = Readonly<Record<string, unknown>>;
type OpenDoc = { doc: Y.Doc; layout: DocLayout };

/** `entry`'s doc while `get` has it open with a layout to read it by. */
function openDocOf(project: IssueProject, entry: AssetEntry): OpenDoc | null {
  const name = project.docNameFor?.(entry);
  const open = name ? project.get?.(name) : undefined;
  return open?.layout ? { doc: open.doc, layout: open.layout } : null;
}

/** The open game-settings doc an `IssueProject` reads its engine block from. */
function settingsDoc(project: IssueProject, view: ProjectView): OpenDoc | null {
  const [entry] = gameSettingsEntries(view);
  return entry ? openDocOf(project, entry) : null;
}

/** Each live runtime kind's (`isRuntimeKind`) open doc, by asset id. */
function runtimeDocs(
  project: IssueProject,
  view: ProjectView,
  kinds: KindRegistry,
): Map<AssetId, OpenDoc> {
  const out = new Map<AssetId, OpenDoc>();
  if (!project.get) return out;
  for (const entry of view.byId.values()) {
    if (!isRuntimeKind(kinds.get(entry.kind))) continue;
    const open = openDocOf(project, entry);
    if (open) out.set(entry.id, open);
  }
  return out;
}

const kindsOf = (project: IssueProject, registry: Registry): KindRegistry =>
  project.kinds ?? createKindRegistry(registry.game);

/**
 * The project's runtime view over the runtime docs `get` has open, which
 * `anim` blocks' animation sources are read through; built on its first
 * read, and undefined while none is open.
 */
export function issueRuntime(
  project: IssueProject,
  registry: Registry,
  view: ProjectView = project.view(),
): Pick<ProjectRuntimeView, "doc"> | undefined {
  const kinds = kindsOf(project, registry);
  const docs = runtimeDocs(project, view, kinds);
  if (docs.size === 0) return undefined;
  let built: ProjectRuntimeView | undefined;
  const read = () => {
    const values = new Map<AssetId, unknown>();
    for (const [id, open] of docs) values.set(id, layoutFromDoc(open.doc, open.layout));
    return runtimeView(view, values, registry, kinds);
  };
  return { doc: <T>(kind: AssetKindName, id: AssetId) => (built ??= read()).doc?.<T>(kind, id) };
}

/**
 * The project's game-settings `engine` block, which scene settings resolve
 * through as Play resolves them: the view's own, else the open doc's;
 * undefined without either.
 */
export function issueEngine(
  project: IssueProject,
  view: ProjectView = project.view(),
): EngineBlock | undefined {
  if (view.engine) return view.engine;
  const open = settingsDoc(project, view);
  if (!open) return undefined;
  const value = layoutFromDoc(open.doc, open.layout);
  return isPlainObject(value.engine) ? value.engine : undefined;
}

export type WatchIssuesOptions = {
  /** Default 150ms. */
  debounceMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Where instances' prefabs come from; a change to one the doc reaches (`prefabsReachedBy`) revalidates. Default none. */
  prefabs?: PrefabSource;
  /** For a prefab doc: the scene size its view centres on (`readDoc`'s `parentBounds`). */
  parentBounds?: Bounds;
  /** With it, asset ids the doc names are checked against the project (`asset-missing`, `asset-kind`) and `anim` blocks against their sources, and settings resolve through its engine block. */
  project?: IssueProject;
};

/** Validates a doc's scene (or a prefab doc's children), turning a validator that throws into an issue instead of an exception. */
export function validateDoc(
  doc: Y.Doc,
  registry: Registry,
  opts: Pick<WatchIssuesOptions, "prefabs" | "parentBounds" | "project"> = {},
): SceneIssue[] {
  try {
    const prefabs = (opts.prefabs ?? EMPTY_PREFAB_SOURCE).library();
    const view = readDoc(doc, {
      registry,
      prefabs,
      ...(opts.parentBounds ? { parentBounds: opts.parentBounds } : {}),
    });
    const project = opts.project?.view();
    const engine = opts.project && project ? issueEngine(opts.project, project) : undefined;
    const runtime =
      opts.project && project ? issueRuntime(opts.project, registry, project) : undefined;
    return validateScene(view.def, registry, {
      prefabs,
      ...(view.kind === "prefab" && view.prefab?.id ? { prefab: view.prefab.id } : {}),
      ...(project ? { project } : {}),
      ...(engine ? { engine } : {}),
      ...(runtime ? { runtime } : {}),
    });
  } catch (err) {
    return [
      makeIssue("schema", {
        message: `The merged scene couldn't be validated: ${err instanceof Error ? err.message : String(err)}`,
      }),
    ];
  }
}

/**
 * Reruns validation on the merged doc after changes settle. Two valid edits
 * can merge into a state neither client wrote (a reference to an entity
 * someone else deleted, two entities given one id at once); those arrive
 * here as `dangling-ref` and `dup-id` issues, never as exceptions.
 */
export function watchIssues(
  doc: Y.Doc,
  registry: Registry,
  onIssues: (issues: SceneIssue[]) => void,
  opts: WatchIssuesOptions = {},
): IssueWatch {
  const debounceMs = opts.debounceMs ?? 150;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const tracked = contentMaps(doc);
  let timer: unknown = null;

  let followed = new Set<Y.Doc>();
  const onFollowed = () => schedule();
  /**
   * Follows the open docs validation reads, the game-settings doc and the
   * runtime docs, which can open, close or change after the watch starts;
   * true when that set changed.
   */
  const followDocs = (): boolean => {
    const project = opts.project;
    const next = new Set<Y.Doc>();
    if (project?.get) {
      const view = project.view();
      const settings = settingsDoc(project, view);
      if (settings) next.add(settings.doc);
      for (const open of runtimeDocs(project, view, kindsOf(project, registry)).values())
        next.add(open.doc);
    }
    let changed = next.size !== followed.size;
    for (const d of followed) if (!next.has(d)) d.off("update", onFollowed);
    for (const d of next) {
      if (followed.has(d)) continue;
      d.on("update", onFollowed);
      changed = true;
    }
    followed = next;
    return changed;
  };
  const unfollow = () => {
    for (const d of followed) d.off("update", onFollowed);
    followed = new Set();
  };
  const run = () => {
    timer = null;
    followDocs();
    const issues = validateDoc(doc, registry, opts);
    onIssues(issues);
    return issues;
  };
  const schedule = () => {
    if (timer !== null) clearTimer(timer);
    timer = setTimer(run, debounceMs);
  };
  const onTransaction = (tr: Y.Transaction) => {
    if (touchesMaps(tr, tracked)) schedule();
  };
  doc.on("afterTransaction", onTransaction);
  const prefabs = opts.prefabs ?? EMPTY_PREFAB_SOURCE;
  const unsubscribe = prefabs.subscribe((changed) => {
    const reached = prefabsReachedBy(readDoc(doc), prefabs.library());
    if (changed.some((id) => reached.has(id))) schedule();
  });
  const projectDoc = opts.project?.projectDoc;
  const registryMaps = projectDoc ? [projectAssetsMap(projectDoc) as Y.Map<unknown>] : [];
  const onProject = (tr: Y.Transaction) => {
    if (touchesMaps(tr, registryMaps)) schedule();
  };
  projectDoc?.on("afterTransaction", onProject);
  const offProject = opts.project?.subscribe?.((e) => {
    if ((e.type === "open" || e.type === "close") && followDocs()) schedule();
  });
  return {
    flush() {
      if (timer !== null) clearTimer(timer);
      return run();
    },
    stop() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      doc.off("afterTransaction", onTransaction);
      projectDoc?.off("afterTransaction", onProject);
      offProject?.();
      unfollow();
      unsubscribe();
    },
  };
}
