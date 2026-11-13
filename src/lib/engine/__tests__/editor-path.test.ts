import { describe, expect, it } from "vite-plus/test";

import { EDITOR_ROOM, editorPath, editorSearch, isEditorLinkPanel } from "../route-paths";

describe("the editor room's links", () => {
  it("opens a project, then its scene and a panel when asked", () => {
    expect(EDITOR_ROOM).toBe("dev");
    expect(editorPath("dry")).toBe("/game/dev?edit=1&project=dry");
    expect(editorPath("tactics", { scene: "ford", panel: "publish" })).toBe(
      "/game/dev?edit=1&project=tactics&scene=ford&panel=publish",
    );
    expect(editorSearch("tactics", { scene: "ford" })).toEqual({
      edit: 1,
      project: "tactics",
      scene: "ford",
    });
  });

  it("takes only the panels a link may open", () => {
    expect(isEditorLinkPanel("publish")).toBe(true);
    for (const value of ["settings", "Publish", "", 1, undefined, ["publish"]]) {
      expect(isEditorLinkPanel(value)).toBe(false);
    }
  });
});
