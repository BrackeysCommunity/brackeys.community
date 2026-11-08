import { createContext, useContext, type ReactElement, type ReactNode } from "react";

import { useStoreValue } from "../session/use-store-value";
import type { Pending, PendingTask } from "./pending";

const PendingContext = createContext<Pending | null>(null);

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

/** The task running in `scope`, re-rendering as tasks start and settle. */
export function useBusy(scope: string): PendingTask | undefined {
  const pending = usePending();
  return useStoreValue(pending.store, () => pending.busy(scope), Object.is);
}
