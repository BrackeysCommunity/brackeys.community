import { createContext, useContext, useLayoutEffect, useRef, useSyncExternalStore } from 'react';

type Listener = () => void;

function createSidebarStore() {
  let sidebar: React.ReactNode = null;
  const listeners = new Set<Listener>();

  return {
    get: () => sidebar,
    set: (node: React.ReactNode) => {
      sidebar = node;
      for (const l of listeners) l();
    },
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

const store = createSidebarStore();
const PageLayoutContext = createContext(store);

export function PageLayoutProvider({ children }: { children: React.ReactNode }) {
  return <PageLayoutContext.Provider value={store}>{children}</PageLayoutContext.Provider>;
}

export function usePageSidebar(sidebar: React.ReactNode) {
  const ctx = useContext(PageLayoutContext);
  const sidebarRef = useRef(sidebar);
  sidebarRef.current = sidebar;

  useLayoutEffect(() => {
    ctx.set(sidebarRef.current);
    return () => ctx.set(null);
  });
}

export function useCurrentSidebar() {
  const ctx = useContext(PageLayoutContext);
  return useSyncExternalStore(ctx.subscribe, ctx.get, ctx.get);
}
