import { TOOL_PRIORITY, type ToolRouter } from "../tool-router";

const STORAGE_KEY = "debug-overlay-mode";
const TOGGLE_KEY = "F3";

export type DebugPanel = {
  getMode: () => string;
  destroy: () => void;
};

/** F3, routed above every tool, cycles `modes`; the last one chosen survives a reload. */
export function createDebugPanel(
  router: ToolRouter,
  modes: readonly string[],
  onModeChange: (mode: string) => void,
): DebugPanel {
  const modeAt = (i: number): string => modes[i] ?? "";

  // Restore from localStorage
  let currentIndex = 0;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const idx = modes.indexOf(stored);
      if (idx >= 0) currentIndex = idx;
    }
  } catch {
    // localStorage may be unavailable
  }

  // Fire initial mode
  onModeChange(modeAt(currentIndex));

  function cycle(): void {
    currentIndex = (currentIndex + 1) % modes.length;
    const mode = modeAt(currentIndex);

    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore
    }

    onModeChange(mode);
  }

  const unregister = router.register({
    id: "debug:overlay",
    priority: TOOL_PRIORITY.debug,
    accepts: (e) => e.kind === "key" && e.type === "down" && e.key === TOGGLE_KEY,
    handle(e) {
      if (e.kind === "key") e.native.preventDefault();
      cycle();
    },
  });

  function getMode(): string {
    return modeAt(currentIndex);
  }

  function destroy(): void {
    unregister();
  }

  return { getMode, destroy };
}
