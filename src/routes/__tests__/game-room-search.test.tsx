import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/components/game/GameCanvas", () => ({ GameCanvas: () => null }));
vi.mock("@/components/game/game-canvas-loading", () => ({ GameCanvasLoading: () => null }));

const { Route } = await import("../game/$roomId");
const validate = Route.options.validateSearch as (search: Record<string, unknown>) => unknown;

describe("the game room's search", () => {
  it("takes the panel a link may open in the editor", () => {
    expect(validate({ edit: "1", project: "tactics", scene: "ford", panel: "publish" })).toEqual({
      edit: 1,
      project: "tactics",
      scene: "ford",
      panel: "publish",
    });
  });

  it("drops a panel no link opens", () => {
    for (const panel of ["settings", "Publish", 1, ["publish"]]) {
      expect(validate({ edit: 1, panel })).toEqual({ edit: 1 });
    }
  });
});
