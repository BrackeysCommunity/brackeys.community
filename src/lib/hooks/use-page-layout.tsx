import { createContext, useContext, useLayoutEffect, useSyncExternalStore } from "react";

type Listener = () => void;
type MobileMode = "sidebar" | "content";

interface LayoutState {
  sidebar: React.ReactNode;
  mobileMode: MobileMode;
}

function createLayoutStore() {
  let state: LayoutState = { sidebar: null, mobileMode: "sidebar" };
  const listeners = new Set<Listener>();
  const notify = () => {
    for (const l of listeners) l();
  };

  return {
    getSidebar: () => state.sidebar,
    getMobileMode: () => state.mobileMode,
    setSidebar: (node: React.ReactNode) => {
      state = { ...state, sidebar: node };
      notify();
    },
    setMobileMode: (mode: MobileMode) => {
      state = { ...state, mobileMode: mode };
      notify();
    },
    reset: () => {
      state = { sidebar: null, mobileMode: "sidebar" };
      notify();
    },
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const store = createLayoutStore();
const PageLayoutContext = createContext(store);

export function PageLayoutProvider({ children }: { children: React.ReactNode }) {
  return <PageLayoutContext.Provider value={store}>{children}</PageLayoutContext.Provider>;
}

export function usePageSidebar(sidebar: React.ReactNode, mobileMode: MobileMode = "sidebar") {
  const ctx = useContext(PageLayoutContext);
  useLayoutEffect(() => {
    ctx.setSidebar(sidebar);
    ctx.setMobileMode(mobileMode);
    return () => ctx.reset();
  });
}

export function useCurrentSidebar() {
  const ctx = useContext(PageLayoutContext);
  return useSyncExternalStore(ctx.subscribe, ctx.getSidebar, ctx.getSidebar);
}

export function useMobileMode() {
  const ctx = useContext(PageLayoutContext);
  return useSyncExternalStore(ctx.subscribe, ctx.getMobileMode, ctx.getMobileMode);
}
