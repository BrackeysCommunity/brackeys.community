import { useKeyPress } from "ahooks";
import { createContext, useContext, useState } from "react";

interface CommandPaletteContextValue {
  open: boolean;
  setOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  /**
   * True once the palette has been opened at least once. `__root.tsx` gates
   * the lazy `CommandPalette` on this: `React.lazy` fetches its chunk the
   * first time the element *renders*, so rendering it unconditionally would
   * pull the palette down during hydration — off the preload graph, but
   * still an extra round trip nobody asked for. It stays mounted afterwards
   * so the dialog keeps its exit animation.
   */
  hasOpened: boolean;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue>({
  open: false,
  setOpen: () => {},
  hasOpened: false,
});

/**
 * Owns the Ctrl/Cmd+K binding, not `CommandPalette` itself: that component
 * is lazy-loaded (see `__root.tsx`), and a listener that only exists inside
 * the lazy chunk couldn't fire before the chunk has fetched. The provider is
 * mounted eagerly at the root, so the binding is live immediately — it just
 * flips `open`, and the palette renders once its chunk resolves.
 */
export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);

  // Adjusting state during render rather than in an effect: React discards
  // this render and re-runs before committing, so the palette mounts in the
  // same commit it opens in instead of a frame later.
  if (open && !hasOpened) setHasOpened(true);

  useKeyPress(
    ["ctrl.k", "meta.k"],
    (e) => {
      e.preventDefault();
      setOpen((prev) => !prev);
    },
    { exactMatch: true },
  );

  return (
    <CommandPaletteContext.Provider value={{ open, setOpen, hasOpened }}>
      {children}
    </CommandPaletteContext.Provider>
  );
}

export const useCommandPalette = () => useContext(CommandPaletteContext);
