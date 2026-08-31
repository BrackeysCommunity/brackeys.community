import { describe, expect, test } from "bun:test";

import sharp from "sharp";

import { hashCover } from "./cover.ts";
import { hammingHex } from "./dhash.ts";

/**
 * Regression coverage for the degenerate-cover bug: a solid black cover, a
 * marker doodle on a transparent PNG, and a solid white cover all used to
 * hash to 0x0 and "identically match" each other across the corpus.
 */

const W = 630;
const H = 500;

function solid(background: string): Promise<Buffer> {
  return sharp({ create: { width: W, height: H, channels: 3, background } })
    .png()
    .toBuffer();
}

/** Black ink on a fully transparent background, like a doodle export. */
function transparentDoodle(): Promise<Buffer> {
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <path d="M 100 100 C 200 50, 300 150, 400 100 S 500 200, 550 150"
      stroke="black" stroke-width="4" fill="none"/>
    <text x="180" y="420" font-size="60" font-family="serif">signature</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** A detailed cover with edges everywhere. */
function busyArt(seed: number): Promise<Buffer> {
  const rects = Array.from({ length: 200 }, (_, i) => {
    const x = (i * 97 + seed * 13) % W;
    const y = (i * 61 + seed * 7) % H;
    const c = ["#3b6", "#c33", "#36c", "#fc0", "#639", "#0aa"][(i + seed) % 6];
    return `<rect x="${x}" y="${y}" width="${40 + (i % 5) * 15}" height="${30 + (i % 7) * 12}" fill="${c}"/>`;
  }).join("");
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe("hashCover", () => {
  test("flat and near-flat covers are unmatchable, not identical", async () => {
    expect(await hashCover(new Uint8Array(await solid("#000000")))).toBeNull();
    expect(await hashCover(new Uint8Array(await solid("#ffffff")))).toBeNull();
    expect(await hashCover(new Uint8Array(await transparentDoodle()))).toBeNull();
  });

  test("detailed covers hash, and different art stays far apart", async () => {
    const a = await hashCover(new Uint8Array(await busyArt(1)));
    const b = await hashCover(new Uint8Array(await busyArt(5)));
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toMatch(/^[0-9a-f]{32}$/);
    expect(hammingHex(a!, b!)).toBeGreaterThan(16);
  });

  test("a re-encode of the same art stays within the near budget", async () => {
    // A scene with decisive large-scale gradients — what real cover art looks
    // like at 9×8. (The busyArt collage is intentionally pathological: its
    // neighbor pairs are near-ties, so their sign bits are noise.)
    const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1a2a6c"/><stop offset="100%" stop-color="#fdbb2d"/>
      </linearGradient></defs>
      <rect width="${W}" height="${H}" fill="url(#sky)"/>
      <circle cx="480" cy="130" r="70" fill="#fff3c4"/>
      <polygon points="0,${H} 200,180 380,${H}" fill="#243b2f"/>
      <polygon points="250,${H} 470,240 ${W},${H}" fill="#101d16"/>
      <rect y="${H - 90}" width="${W}" height="90" fill="#0a120d"/>
    </svg>`;
    const original = await sharp(Buffer.from(svg)).png().toBuffer();
    const recompressed = await sharp(original).jpeg({ quality: 55 }).toBuffer();
    const resized = await sharp(original).resize(315, 250).jpeg({ quality: 80 }).toBuffer();
    const h0 = await hashCover(new Uint8Array(original));
    const h1 = await hashCover(new Uint8Array(recompressed));
    const h2 = await hashCover(new Uint8Array(resized));
    expect(hammingHex(h0!, h1!)).toBeLessThanOrEqual(12);
    expect(hammingHex(h0!, h2!)).toBeLessThanOrEqual(12);
  });

  test("undecodable bytes hash to null", async () => {
    expect(await hashCover(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]))).toBeNull();
  });
});
