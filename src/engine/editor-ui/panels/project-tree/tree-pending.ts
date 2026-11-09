import { useEffect, useState } from "react";

import type { AssetEntry } from "../../../project/index";
import type { EditorNotify } from "../../host";
import { createPending, type Pending, type PendingStep } from "../../pending/pending";
import { usePending } from "../../pending/use-pending";

/** The pending scope of an asset's row: busy while it's renamed, moved, deleted or restored. */
export const assetScope = (entry: Pick<AssetEntry, "key">) => `project:asset:${entry.key}`;

/** The pending scope of the folder ("" for the root) an import was dropped on. */
export const importScope = (folder: string) => `project:import:${folder}`;
export const IMPORT_SCOPE_PREFIX = "project:import:";

/** The pending scope of one licence field of an asset. */
export const licenceScope = (entry: Pick<AssetEntry, "key">, field: string) =>
  `project:licence:${entry.key}:${field}`;

function useEditorPending(): Pending | null {
  try {
    return usePending();
  } catch {
    return null;
  }
}

/**
 * The editor's `Pending`, or, for a tree or form rendered outside an editor,
 * one of its own that reports through `notify`.
 */
export function useTreePending(notify: Pick<EditorNotify, "error">): Pending {
  const shared = useEditorPending();
  const [own] = useState(() => ownPending(notify));
  useEffect(() => {
    own.retarget(notify);
  });
  return shared ?? own.pending;
}

/** A `Pending` whose errors go to the `notify` it was last retargeted to. */
function ownPending(notify: Pick<EditorNotify, "error">) {
  let say = notify;
  const quiet = () => undefined;
  const relay: EditorNotify = Object.assign(quiet, {
    success: quiet,
    warning: quiet,
    error: (message: string, opts?: { description?: string }) => say.error(message, opts),
  });
  return {
    pending: createPending({ notify: relay }),
    retarget(next: Pick<EditorNotify, "error">) {
      say = next;
    },
  };
}

/** A host error that carries its own `description`: the toast is titled by its message. */
class Described extends Error {
  constructor(
    readonly title: string,
    description: string,
  ) {
    super(description);
  }
}

const descriptionOf = (err: unknown) =>
  err instanceof Error && "description" in err && typeof err.description === "string"
    ? err.description
    : undefined;

/**
 * Runs a host callback as a pending task: busy in `scope` until it settles,
 * a rejection toasted once titled `fallback` with the error's message, or by
 * the error's message when it carries a `description`.
 */
export function runOp<T>(
  pending: Pending,
  spec: { id: string; scope: string; label: string; fallback: string; total?: number },
  fn: (step: PendingStep) => T | Promise<T>,
) {
  const { fallback, ...run } = spec;
  return pending.run(
    { ...run, error: (err) => (err instanceof Described ? err.title : fallback) },
    async (step) => {
      try {
        return await fn(step);
      } catch (err) {
        const description = descriptionOf(err);
        if (description === undefined) throw err;
        throw new Described(
          err instanceof Error && err.message ? err.message : fallback,
          description,
        );
      }
    },
  );
}
