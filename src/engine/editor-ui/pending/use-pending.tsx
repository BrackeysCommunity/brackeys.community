import { Store } from "@tanstack/store";
import { createContext, useContext, type ReactElement, type ReactNode } from "react";

import { useStoreValue } from "../session/use-store-value";
import type { Pending, PendingTask } from "./pending";

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
