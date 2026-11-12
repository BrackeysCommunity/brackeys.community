import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

import { hostCue, hostStorage, type EditorCue, type EditorHost, type EditorStorage } from "../host";

export type KitContextValue = {
  cue: (cue: EditorCue) => void;
  storage: EditorStorage;
  /** Where every kit portal renders; null until it mounts, and outside a `KitProvider`. */
  container: HTMLElement | null;
};

const silent = (): void => {};

const KitContext = createContext<KitContextValue>({
  cue: silent,
  storage: hostStorage({}),
  container: null,
});

/**
 * The kit's view of the host: its cues, its storage and the portal container,
 * a `.je-root` sibling of `children` so tokens reach menus, hints and dialogs.
 */
export function KitProvider({
  host,
  theme,
  children,
}: {
  host: Pick<EditorHost, "cue" | "storage">;
  /** Pins the portal container's theme, as `data-je-theme` does on the frame. */
  theme?: "light" | "dark";
  children: ReactNode;
}) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const { cue, storage } = host;
  const value = useMemo<KitContextValue>(
    () => ({ cue: hostCue({ cue }), storage: hostStorage({ storage }), container }),
    [cue, storage, container],
  );
  return (
    <KitContext.Provider value={value}>
      {children}
      <div ref={setContainer} className="je-root je-portal" data-je-theme={theme} />
    </KitContext.Provider>
  );
}

export function useKit(): KitContextValue {
  return useContext(KitContext);
}

/** The container a kit portal renders into, or undefined for the document body. */
export function usePortalContainer(): HTMLElement | undefined {
  return useContext(KitContext).container ?? undefined;
}
