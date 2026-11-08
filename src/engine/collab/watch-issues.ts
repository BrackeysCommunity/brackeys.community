import type * as Y from "yjs";

import type { Registry } from "../game/types";
import type { ProjectView } from "../project/types";
import { makeIssue } from "../scene/issues";
import type { Bounds, SceneIssue } from "../scene/types";
import { validateScene } from "../scene/validate";
import { contentMaps, readDoc, touchesMaps } from "./convert";
import { EMPTY_PREFAB_SOURCE, type PrefabSource } from "./prefab-source";
import { projectAssetsMap } from "./project-doc";

export type IssueWatch = {
  /** Validates now, skipping the wait. */
  flush(): SceneIssue[];
  stop(): void;
};

/**
 * The project a doc belongs to, as validation reads it: a `ProjectSession`
 * fits. A change to `projectDoc`'s registry (an asset added, renamed or
 * trashed) revalidates.
 */
export type IssueProject = { view(): ProjectView; readonly projectDoc?: Y.Doc };

export type WatchIssuesOptions = {
  /** Default 150ms. */
  debounceMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Where instances' prefabs come from; a change to one the scene uses revalidates. Default none. */
  prefabs?: PrefabSource;
  /** For a prefab doc: the scene size its view centres on (`readDoc`'s `parentBounds`). */
  parentBounds?: Bounds;
  /** With it, asset ids the doc names are checked against the project (`asset-missing`, `asset-kind`). */
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
    return validateScene(view.def, registry, {
      prefabs,
      ...(view.kind === "prefab" && view.prefab?.id ? { prefab: view.prefab.id } : {}),
      ...(project ? { project } : {}),
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

  const run = () => {
    timer = null;
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
  const unsubscribe = (opts.prefabs ?? EMPTY_PREFAB_SOURCE).subscribe((changed) => {
    const used = readDoc(doc).def.instances ?? [];
    if (used.some((i) => changed.includes(i.prefab))) schedule();
  });
  const projectDoc = opts.project?.projectDoc;
  const registryMaps = projectDoc ? [projectAssetsMap(projectDoc) as Y.Map<unknown>] : [];
  const onProject = (tr: Y.Transaction) => {
    if (touchesMaps(tr, registryMaps)) schedule();
  };
  projectDoc?.on("afterTransaction", onProject);
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
      unsubscribe();
    },
  };
}
