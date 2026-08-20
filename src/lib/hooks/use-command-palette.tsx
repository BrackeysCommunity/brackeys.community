import { useKeyPress } from "ahooks";
import { createContext, useContext, useState } from "react";

interface CommandPaletteContextValue {
  open: boolean;
  setOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
}

const CommandPaletteContext = createContext<CommandPaletteContextValue>({
  open: false,
  setOpen: () => {},
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

  useKeyPress(
    ["ctrl.k", "meta.k"],
    (e) => {
      e.preventDefault();
      setOpen((prev) => !prev);
    },
    { exactMatch: true },
  );

  return (
    <CommandPaletteContext.Provider value={{ open, setOpen }}>
      {children}
    </CommandPaletteContext.Provider>
  );
}

export const useCommandPalette = () => useContext(CommandPaletteContext);
