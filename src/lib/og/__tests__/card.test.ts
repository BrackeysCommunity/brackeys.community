import { describe, expect, it } from "vite-plus/test";

import { ogCard } from "@/lib/og/card";
import { renderOgPng } from "@/lib/og/render";

/**
 * The renderer end to end. Slow, but a font that did not decode still
 * returns a perfectly valid PNG of empty boxes, so nothing else catches it.
 * Set `OG_DUMP=<dir>` to write the frames out and look at them.
 */

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

/** Width and height live at bytes 16–24 of the IHDR chunk. */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function render(name: string, node: Parameters<typeof renderOgPng>[0]) {
  const png = await renderOgPng(node);
  const dir = process.env.OG_DUMP;
  if (dir) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(`${dir}/${name}.png`, png);
  }
  return png;
}

describe("og card renderer", () => {
  it("renders a full card at exactly 1200×630", async () => {
    const png = await render("jam", {
      ...ogCard({
        kind: "jam",
        eyebrow: "Game jam",
        title: "Brackeys Game Jam 2026.1",
        subtitle: "14 Feb – 23 Feb 2026 · Hosted by Brackeys",
        stats: [
          { value: "1,204", label: "Entries" },
          { value: "8,912", label: "Ratings" },
          { value: "Ended", label: "Status" },
        ],
      }),
    });

    expect([...png.slice(0, 4)]).toEqual(PNG_MAGIC);
    expect(pngSize(png)).toEqual({ width: 1200, height: 630 });
  }, 30_000);

  it("renders without art, stats or a subtitle", async () => {
    const png = await render("bare", {
      ...ogCard({ kind: "site", eyebrow: "Community", title: "Brackeys Community" }),
    });
    expect(pngSize(png)).toEqual({ width: 1200, height: 630 });
  }, 30_000);

  it("renders cover art as a panel and an avatar as a disc", async () => {
    const swatch = (from: string, to: string) =>
      `data:image/svg+xml;base64,${Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="600" height="600" fill="url(#g)"/></svg>`,
      ).toString("base64")}`;

    const panel = await render("project", {
      ...ogCard({
        kind: "project",
        eyebrow: "Game",
        title: "PROTOCOL 0",
        subtitle:
          "A short first-person puzzle game about talking your way out of a locked server room.",
        stats: [
          { value: "3", label: "Jams" },
          { value: "2024", label: "Released" },
        ],
        art: { dataUri: swatch("#5865f2", "#0b1030"), shape: "panel" },
      }),
    });
    expect(pngSize(panel)).toEqual({ width: 1200, height: 630 });

    const disc = await render("profile", {
      ...ogCard({
        kind: "profile",
        eyebrow: "Member",
        title: "mellobacon",
        subtitle: "Composer and sound designer · Open to work · Lisbon-ish",
        stats: [
          { value: "12", label: "Jams" },
          { value: "5", label: "Projects" },
          { value: "Part time", label: "Available" },
        ],
        art: { dataUri: swatch("#d2356b", "#2a0a18"), shape: "circle" },
      }),
    });
    expect(pngSize(disc)).toEqual({ width: 1200, height: 630 });
  }, 30_000);

  it("survives a title long enough to need clamping", async () => {
    const png = await render("long", {
      ...ogCard({
        kind: "collab",
        eyebrow: "Open role",
        title:
          "Looking for a pixel artist, a composer and a gameplay programmer for a long-term commercial roguelike deckbuilder project",
        subtitle:
          "Paid, $25–40/hr, remote. We have a vertical slice, a publisher conversation in progress, and about nine months of runway to get to Early Access.",
        stats: [{ value: "3 roles", label: "Open" }],
      }),
    });
    expect(pngSize(png)).toEqual({ width: 1200, height: 630 });
  }, 30_000);
});
