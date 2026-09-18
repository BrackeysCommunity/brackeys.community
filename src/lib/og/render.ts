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

/** Thrown when a card waited out `RENDER_WAIT_MS` for the rasterizer. */
export class OgRenderBusyError extends Error {
  constructor() {
    super("OG rasterizer busy");
    this.name = "OgRenderBusyError";
  }
}

// satori's layout and resvg's rasterize are both synchronous CPU work on the
// server's only thread, so concurrent cards never overlap — they queue behind
// each other and hold the event loop, which stalls every other route. One card
// at a time, and a bounded wait: past the deadline the caller degrades to the
// static card rather than lengthening the queue.
const RENDER_CONCURRENCY = 1;
const RENDER_WAIT_MS = 2_000;

type Waiter = {
  resolve: () => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

let active = 0;
const waiting: Waiter[] = [];

function acquire(): Promise<void> {
  if (active < RENDER_CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const waiter: Waiter = {
      resolve,
      reject,
      timer: setTimeout(() => {
        const index = waiting.indexOf(waiter);
        if (index !== -1) waiting.splice(index, 1);
        reject(new OgRenderBusyError());
      }, RENDER_WAIT_MS),
    };
    waiting.push(waiter);
  });
}

function release() {
  const next = waiting.shift();
  // The slot is handed straight to the next waiter, so `active` is unchanged.
  if (next) {
    clearTimeout(next.timer);
    next.resolve();
    return;
  }
  active--;
}

export async function renderOgPng(node: OgNode): Promise<Uint8Array> {
  await acquire();
  try {
    return await rasterize(node);
  } finally {
    release();
  }
}

async function rasterize(node: OgNode): Promise<Uint8Array> {
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
