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
  const { open } = useCommandPalette();
  return <span data-testid="open-state">{String(open)}</span>;
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
});
