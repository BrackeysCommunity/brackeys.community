import { Store } from "@tanstack/store";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import type { EditorNotify, NotifyOptions } from "../host";
import { useStoreValue } from "../session/use-store-value";
import { createPending, type Pending, type PendingTask } from "./pending";

const PendingContext = createContext<Pending | null>(null);

const NO_TASKS = new Store<{ tasks: readonly PendingTask[] }>({ tasks: [] });

/** The editor's `Pending`, for every control and panel below. */
export function PendingProvider({
  pending,
  children,
}: {
  pending: Pending;
  children: ReactNode;
}): ReactElement {
  return <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>;
}

export function usePending(): Pending {
  const pending = useContext(PendingContext);
  if (!pending) throw new Error("usePending: no PendingProvider above this component");
  return pending;
}

/** The editor's `Pending`, or null when nothing above provides one. */
export function useOptionalPending(): Pending | null {
  return useContext(PendingContext);
}

/** Where a stand-alone `Pending` reports: errors always, successes and warnings when given. */
export type OwnPendingNotify = Pick<EditorNotify, "error"> &
  Partial<Pick<EditorNotify, "success" | "warning">>;

/**
 * The editor's `Pending`, or, for a panel or form rendered outside an editor,
 * a stable one of its own that reports through the latest `notify`. Render
 * the result under a `PendingProvider` so `useBusy` and `Button busyScope`
 * below see its tasks either way.
 */
export function useOwnOrSharedPending(notify: OwnPendingNotify): Pending {
  const shared = useOptionalPending();
  const [own] = useState(() => relayedPending(notify));
  useEffect(() => {
    own.retarget(notify);
  });
  return shared ?? own.pending;
}

function relayedPending(notify: OwnPendingNotify) {
  let say = notify;
  const quiet = () => undefined;
  const relay: EditorNotify = Object.assign(quiet, {
    success: (message: string, opts?: NotifyOptions) => say.success?.(message, opts),
    warning: (message: string, opts?: NotifyOptions) => say.warning?.(message, opts),
    error: (message: string, opts?: NotifyOptions) => say.error(message, opts),
  });
  return {
    pending: createPending({ notify: relay }),
    retarget(next: OwnPendingNotify) {
      say = next;
    },
  };
}

/** The running tasks, oldest first; none outside a `PendingProvider`. */
export function usePendingTasks(): readonly PendingTask[] {
  const pending = useContext(PendingContext);
  return useStoreValue(pending?.store ?? NO_TASKS, (s) => s.tasks, Object.is);
}

/**
 * The newest task running in `scope`, re-rendering as tasks start and
 * settle. Undefined outside a `PendingProvider`, so a control can ask
 * wherever it's rendered.
 */
export function useBusy(scope: string): PendingTask | undefined {
  const pending = useContext(PendingContext);
  return useStoreValue(
    pending?.store ?? NO_TASKS,
    () => (pending ? pending.busy(scope) : undefined),
    Object.is,
  );
}
