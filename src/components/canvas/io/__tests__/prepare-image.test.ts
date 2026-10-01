import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ImageTooLargeError, prepareImage } from "../prepare-image";

afterEach(() => vi.unstubAllGlobals());

const file = (bytes: number, type: string) =>
  new File([new Uint8Array(bytes)], `shot.${type.split("/")[1]}`, { type });

function stubBitmap(width: number, height: number) {
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width, height, close: () => {} })),
  );
}

describe("prepareImage", () => {
  it("leaves a small image alone", async () => {
    stubBitmap(1200, 800);
    const small = file(200_000, "image/png");
    expect(await prepareImage(small)).toBe(small);
  });

  it("passes GIFs through, refusing only ones over the cap", async () => {
    const gif = file(1_000, "image/gif");
    expect(await prepareImage(gif)).toBe(gif);
    await expect(prepareImage(file(6 * 1024 * 1024, "image/gif"))).rejects.toBeInstanceOf(
      ImageTooLargeError,
    );
  });
});
