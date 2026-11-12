// @vitest-environment jsdom
import { describe, expect, it, vi } from "vite-plus/test";

import type { SceneFallback } from "../connect/scene-doc";
import { fallbackNotice } from "../SceneEditor";

const fellBack: SceneFallback = {
  wanted: "7c1d2e3f",
  opened: "a0b1c2d3",
  openedName: "test-yard",
  project: { id: "platformer", name: "Platformer" },
};
const home = { project: "engine", id: "7c1d2e3f", name: "grid-yard" };
const nameOf = (id: string) => (id === "engine" ? "Engine" : id);

describe("fallbackNotice", () => {
  it("says what opened when no other project holds the scene", () => {
    expect(fallbackNotice(fellBack, null, nameOf)).toEqual({
      message: 'There\'s no scene "7c1d2e3f" in Platformer',
      description: "test-yard opened instead.",
    });
    expect(fallbackNotice(fellBack, { ...home, project: "platformer" }, nameOf, vi.fn())).toEqual({
      message: 'There\'s no scene "7c1d2e3f" in Platformer',
      description: "test-yard opened instead.",
    });
  });

  it("points to the scene's project by name, through the Project panel without an action", () => {
    expect(fallbackNotice(fellBack, home, nameOf)).toEqual({
      message: 'There\'s no scene "grid-yard" in Platformer',
      description:
        "It's in Engine: switch to that project in the Project panel. test-yard opened instead.",
    });
  });

  it("offers an action that opens the scene itself in its own project", () => {
    const open = vi.fn();
    const notice = fallbackNotice(fellBack, home, nameOf, open);
    expect(notice).toMatchObject({
      message: 'There\'s no scene "grid-yard" in Platformer',
      description: "It's in Engine. test-yard opened instead.",
      action: { label: "Open in Engine" },
    });
    notice.action!.onClick();
    expect(open).toHaveBeenCalledWith(home);
  });
});
