import type * as Y from "yjs";

import type { Registry } from "../game/types";
import { makeIssue } from "../scene/issues";
import type { SceneIssue } from "../scene/types";
import { validateScene } from "../scene/validate";
import { contentMaps, readDoc, touchesMaps } from "./convert";

export type IssueWatch = {
  /** Validates now, skipping the wait. */
  flush(): SceneIssue[];
  stop(): void;
};

export type WatchIssuesOptions = {
  /** Default 150ms. */
  debounceMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

/** Validates a doc's scene, turning a validator that throws into an issue instead of an exception. */
export function validateDoc(doc: Y.Doc, registry: Registry): SceneIssue[] {
  try {
    const view = readDoc(doc);
    return validateScene(view.def, registry, { prefabs: view.prefabs });
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
    const issues = validateDoc(doc, registry);
    onIssues(issues);
    return issues;
  };
  const onTransaction = (tr: Y.Transaction) => {
    if (!touchesMaps(tr, tracked)) return;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(run, debounceMs);
  };
  doc.on("afterTransaction", onTransaction);
  return {
    flush() {
      if (timer !== null) clearTimer(timer);
      return run();
    },
    stop() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      doc.off("afterTransaction", onTransaction);
    },
  };
}
