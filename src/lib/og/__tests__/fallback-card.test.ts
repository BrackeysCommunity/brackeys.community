import { describe, expect, it } from "vite-plus/test";

import { ogCard } from "@/lib/og/card";
import { siteCard } from "@/lib/og/data";
import { renderOgPng } from "@/lib/og/render";

/**
 * Also how `public/og/brackeys-card.png` is regenerated — a standalone
 * script can't resolve the `?inline` font imports:
 *
 *   bun run og:card
 */
describe("the committed fallback card", () => {
  it("renders, and is written out when OG_DUMP asks for it", async () => {
    const png = await renderOgPng(ogCard(siteCard()));

    expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630]);

    const dir = process.env.OG_DUMP;
    if (dir) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(`${dir}/brackeys-card.png`, png);
    }
  }, 30_000);
});
