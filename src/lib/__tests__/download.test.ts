// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { downloadBlob } from "../download";

describe("downloadBlob", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("clicks a detached download anchor and revokes its URL afterwards", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn((_blob: Blob) => "blob:file");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    let clicked: { download: string; href: string; rel: string; attached: boolean } | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        clicked = {
          download: this.download,
          href: this.href,
          rel: this.rel,
          attached: this.isConnected,
        };
      },
    );
    const blob = new Blob(["{}"], { type: "application/json" });

    downloadBlob("level.json", blob);

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked).toEqual({
      download: "level.json",
      href: "blob:file",
      rel: "noopener",
      attached: true,
    });
    expect(document.querySelector("a")).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:file");
  });
});
