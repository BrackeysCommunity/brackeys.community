import { cleanup, fireEvent, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";

import { CommandPaletteProvider, useCommandPalette } from "@/lib/hooks/use-command-palette";

/**
 * `CommandPalette` (the component) is lazy-loaded from `__root.tsx`, so the
 * Ctrl/Cmd+K binding has to live in the provider — a listener inside the
 * lazy chunk couldn't fire before that chunk has fetched. This exercises
 * the provider alone, with no `<CommandPalette />` mounted, to prove the
 * binding doesn't depend on it.
 */
function OpenState() {
  const { open, hasOpened } = useCommandPalette();
  return (
    <>
      <span data-testid="open-state">{String(open)}</span>
      <span data-testid="has-opened">{String(hasOpened)}</span>
    </>
  );
}

function pressCtrlK() {
  fireEvent.keyDown(window, { key: "k", ctrlKey: true, keyCode: 75, which: 75 });
}

afterEach(cleanup);

describe("CommandPaletteProvider", () => {
  it("toggles open on Ctrl+K with no palette mounted", () => {
    render(
      <CommandPaletteProvider>
        <OpenState />
      </CommandPaletteProvider>,
    );

    expect(screen.getByTestId("open-state").textContent).toBe("false");

    pressCtrlK();
    expect(screen.getByTestId("open-state").textContent).toBe("true");

    pressCtrlK();
    expect(screen.getByTestId("open-state").textContent).toBe("false");
  });

  // `__root.tsx` gates the lazy palette on `hasOpened`, so its chunk is not
  // fetched during hydration — but once latched it must stay latched, or
  // closing the palette would unmount it mid exit-animation.
  it("latches hasOpened on first open and keeps it after closing", () => {
    render(
      <CommandPaletteProvider>
        <OpenState />
      </CommandPaletteProvider>,
    );

    expect(screen.getByTestId("has-opened").textContent).toBe("false");

    pressCtrlK();
    expect(screen.getByTestId("has-opened").textContent).toBe("true");

    pressCtrlK();
    expect(screen.getByTestId("open-state").textContent).toBe("false");
    expect(screen.getByTestId("has-opened").textContent).toBe("true");
  });
});
