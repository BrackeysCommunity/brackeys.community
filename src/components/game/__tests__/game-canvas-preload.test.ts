import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { warnFailedTextures } from "../GameCanvas";

describe("warnFailedTextures", () => {
  afterEach(() => vi.restoreAllMocks());

  it("names each texture the preload couldn't load", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnFailedTextures("level-1", [{ id: "sky" }, { id: "hero" }]);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith("[assets] level-1: 2 texture(s) failed to load: sky, hero");
  });

  it("stays quiet when every texture loaded", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnFailedTextures("level-1", []);
    expect(warn).not.toHaveBeenCalled();
  });
});
