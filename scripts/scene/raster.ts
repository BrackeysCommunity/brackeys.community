import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { initWasm, Resvg } from "@resvg/resvg-wasm";

/** The site's Rubik, the same files the OG cards load. */
const FONT_FILES = ["rubik-latin-400.ttf", "rubik-latin-700.ttf"].map((f) =>
  fileURLToPath(new URL(`../../src/lib/og/assets/${f}`, import.meta.url)),
);

let ready: Promise<Uint8Array[]> | null = null;

/** `initWasm` throws if called twice, so the promise is the lock; the fonts load with it. */
function ensureReady(): Promise<Uint8Array[]> {
  ready ??= (async () => {
    const require = createRequire(import.meta.url);
    await initWasm(await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
    return Promise.all(FONT_FILES.map(async (f) => new Uint8Array(await readFile(f))));
  })().catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

export type Raster = { png: Uint8Array; width: number; height: number; pixels: Uint8Array };

/** SVG text to a PNG at the SVG's own size, with Rubik as the only font. */
export async function rasterizeSvg(svg: string): Promise<Raster> {
  const fontBuffers = await ensureReady();
  const resvg = new Resvg(svg, {
    fitTo: { mode: "original" },
    font: { fontBuffers, defaultFontFamily: "Rubik", sansSerifFamily: "Rubik" },
  });
  try {
    const image = resvg.render();
    try {
      return { png: image.asPng(), width: image.width, height: image.height, pixels: image.pixels };
    } finally {
      image.free();
    }
  } finally {
    resvg.free();
  }
}
