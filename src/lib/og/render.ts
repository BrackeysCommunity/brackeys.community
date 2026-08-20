import { readFile } from "node:fs/promises";
/**
 * Satori → SVG → PNG. Server only, and heavy enough that `src/routes/og.$.ts`
 * imports it lazily. wasm rather than `@resvg/resvg-js`, whose native build
 * resolves a per-platform binary a darwin lockfile gets wrong on linux.
 */
import { createRequire } from "node:module";

import { initWasm, Resvg } from "@resvg/resvg-wasm";
import satori from "satori";

import { OG_HEIGHT, OG_WIDTH, type OgNode } from "./card";
import { ogFonts } from "./fonts";

let wasmReady: Promise<void> | null = null;

/** `initWasm` throws if called twice, so the promise is the lock. */
function ensureWasm(): Promise<void> {
  wasmReady ??= (async () => {
    const require = createRequire(import.meta.url);
    const wasmPath = require.resolve("@resvg/resvg-wasm/index_bg.wasm");
    await initWasm(await readFile(wasmPath));
  })().catch((error) => {
    // Don't leave a settled rejection behind; the next card retries.
    wasmReady = null;
    throw error;
  });
  return wasmReady;
}

export async function renderOgPng(node: OgNode): Promise<Uint8Array> {
  const svg = await satori(node as Parameters<typeof satori>[0], {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: ogFonts(),
  });

  await ensureWasm();
  const resvg = new Resvg(svg, {
    fitTo: { mode: "original" },
  });
  return resvg.render().asPng();
}
