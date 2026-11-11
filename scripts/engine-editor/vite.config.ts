import { join } from "node:path";
import { fileURLToPath } from "node:url";

import * as hocuspocus from "@hocuspocus/server";
import { readFileProject, sceneCollabServer } from "@jams/engine/vite";
import wasm from "vite-plugin-wasm";
import type { InlineConfig } from "vite-plus";

const PAGE_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO = fileURLToPath(new URL("../..", import.meta.url));
const ENGINE = fileURLToPath(new URL("../../src/engine/", import.meta.url));

/** Vite's own port is never this one: the owner's tooling holds it. */
export const RESERVED_PORT = 42069;

export type EngineEditorConfigOptions = {
  /** The engine project's directory the collab server reads and writes. */
  scenesDir: string;
  /** The collab server's content store and persisted docs. */
  cacheDir: string;
  /** Both sides stamp builds with this, so the page and the server agree on the newest. */
  buildAt: number;
  port?: number;
  host?: string;
  open?: boolean;
  /** Collab refusals, repairs and failed loads; default `console.warn`. */
  warn?: (message: string) => void;
};

/**
 * The standalone editor's dev server: this directory's page, the engine
 * resolved from source as `@jams/engine/*`, and `./vite`'s collab server over
 * the engine project in `scenesDir`, judged as the page judges it: by the
 * engine alone, since the project names no game. No site module is reachable from it.
 */
export async function engineEditorConfig(opts: EngineEditorConfigOptions): Promise<InlineConfig> {
  const port = opts.port ?? 5173;
  if (port === RESERVED_PORT) throw new Error(`port ${RESERVED_PORT} is reserved; pick another`);
  const project = await readFileProject(opts.scenesDir, { game: null, cacheDir: opts.cacheDir });
  return {
    configFile: false,
    root: PAGE_DIR,
    // Its own: the site's dev server reads node_modules/.vite while it runs.
    cacheDir: join(REPO, "node_modules/.vite-engine-editor"),
    // The repo's .env files are the site's, not this page's.
    envDir: PAGE_DIR,
    logLevel: "info",
    clearScreen: false,
    define: { "import.meta.env.VITE_BUILD_AT": JSON.stringify(String(opts.buildAt)) },
    resolve: {
      alias: [
        {
          find: /^@jams\/engine\/editor-ui\/style\.css$/,
          replacement: `${ENGINE}editor-ui/style.css`,
        },
        { find: /^@jams\/engine$/, replacement: `${ENGINE}index.ts` },
        { find: /^@jams\/engine\/(.+)$/, replacement: `${ENGINE}$1/index.ts` },
      ],
    },
    plugins: [
      wasm(),
      sceneCollabServer({
        projects: [project],
        hocuspocus,
        buildAt: opts.buildAt,
        ...(opts.warn ? { warn: opts.warn } : {}),
      }),
    ],
    server: {
      port,
      strictPort: false,
      host: opts.host ?? "localhost",
      open: opts.open ?? false,
      fs: { allow: [REPO] },
      // The scratch copy changes under the editor; the page needn't reload for it.
      watch: { ignored: [`${opts.scenesDir}/**`, `${opts.cacheDir}/**`] },
    },
  };
}
