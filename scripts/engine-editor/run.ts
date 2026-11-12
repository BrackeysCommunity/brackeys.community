/**
 * The engine's scene editor without the site: a Vite dev server for this
 * directory's page with `./vite`'s collab server over the engine project
 * (`packages/engine/scenes`: the kitchen sink and the engine yard).
 *
 *   vp run engine:editor [--in-place] [--port <n>] [--host <name>] [--open]
 *
 * Edits land in a scratch copy of the project, removed on exit, unless
 * `--in-place` is passed: then they're written to the repo's files.
 *
 * Runs under Node, whose http upgrades Hocuspocus needs; the config and the
 * engine load through Vite's module runner with the repo's tsconfig paths.
 */
import { cp, mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { createServer, runnerImport, type ViteDevServer } from "vite-plus";

const CONFIG = fileURLToPath(new URL("./vite.config.ts", import.meta.url));

/** The engine project as the repo holds it. */
export const REPO_SCENES = fileURLToPath(new URL("../../packages/engine/scenes", import.meta.url));

export type EngineScenes = {
  /** The project directory the collab server edits. */
  dir: string;
  cacheDir: string;
  /** Whether `dir` is the repo's own copy. */
  inPlace: boolean;
  /** Deletes the scratch copy and the cache; never the repo's files. */
  remove(): Promise<void>;
};

/**
 * Where the editor's edits go: a fresh copy of `from` in a temp directory,
 * or `from` itself with `inPlace`. The collab cache is always fresh, so no
 * other dev server's stamps or persisted docs carry over.
 */
export async function engineScenes(
  opts: { inPlace?: boolean; from?: string } = {},
): Promise<EngineScenes> {
  const from = opts.from ?? REPO_SCENES;
  const inPlace = opts.inPlace ?? false;
  const root = await mkdtemp(join(tmpdir(), "jams-engine-editor-"));
  const remove = () => rm(root, { recursive: true, force: true, maxRetries: 3 });
  const cacheDir = join(root, "cache");
  if (inPlace) return { dir: from, cacheDir, inPlace, remove };
  const dir = join(root, "scenes");
  try {
    await cp(from, dir, { recursive: true });
  } catch (err) {
    await remove();
    throw err;
  }
  return { dir, cacheDir, inPlace, remove };
}

export type EngineEditor = {
  server: ViteDevServer;
  scenes: EngineScenes;
  /** `http://host:port`. */
  origin: string;
  /** The editor, which opens the kitchen sink. */
  url: string;
  /** Stops the server, then removes the scratch copy. */
  close(): Promise<void>;
};

export type EngineEditorOptions = {
  inPlace?: boolean;
  /** Default Vite's 5173, or the next free port after it; 0 takes any free one. */
  port?: number;
  host?: string;
  open?: boolean;
  /** The project to copy or edit; default `REPO_SCENES`. */
  from?: string;
  warn?: (message: string) => void;
};

export async function startEngineEditor(opts: EngineEditorOptions = {}): Promise<EngineEditor> {
  const scenes = await engineScenes({
    ...(opts.inPlace !== undefined ? { inPlace: opts.inPlace } : {}),
    ...(opts.from !== undefined ? { from: opts.from } : {}),
  });
  let server: ViteDevServer | null = null;
  try {
    const { module } = await runnerImport<typeof import("./vite.config.ts")>(CONFIG, {
      configFile: false,
      resolve: { tsconfigPaths: true },
    });
    const { engineEditorConfig } = module;
    server = await createServer(
      await engineEditorConfig({
        scenesDir: scenes.dir,
        cacheDir: scenes.cacheDir,
        buildAt: Date.now(),
        ...(opts.port !== undefined ? { port: opts.port } : {}),
        ...(opts.host !== undefined ? { host: opts.host } : {}),
        ...(opts.open !== undefined ? { open: opts.open } : {}),
        ...(opts.warn ? { warn: opts.warn } : {}),
      }),
    );
    await server.listen();
  } catch (err) {
    await server?.close();
    await scenes.remove();
    throw err;
  }
  const running = server;
  const address = running.httpServer?.address() as AddressInfo | null;
  if (!address) throw new Error("the editor's dev server isn't listening");
  const hostname = opts.host ?? "localhost";
  const origin = `http://${hostname.includes(":") ? `[${hostname}]` : hostname}:${address.port}`;
  let closing: Promise<void> | null = null;
  return {
    server: running,
    scenes,
    origin,
    url: `${origin}/`,
    close: () =>
      (closing ??= (async () => {
        await running.close();
        // The collab server's last writes finish after its socket closes.
        await new Promise((r) => setTimeout(r, 200));
        if (!scenes.inPlace) await scenes.remove();
        else await rm(scenes.cacheDir, { recursive: true, force: true, maxRetries: 3 });
      })()),
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "in-place": { type: "boolean", default: false },
      port: { type: "string" },
      host: { type: "string" },
      open: { type: "boolean", default: false },
    },
  });
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && !Number.isInteger(port)) throw new Error(`--port ${values.port}?`);
  const editor = await startEngineEditor({
    inPlace: values["in-place"],
    open: values.open,
    ...(port !== undefined ? { port } : {}),
    ...(values.host !== undefined ? { host: values.host } : {}),
  });
  console.log(
    editor.scenes.inPlace
      ? `editing the repo's engine project in place: ${editor.scenes.dir}`
      : `editing a scratch copy of the engine project: ${editor.scenes.dir}`,
  );
  console.log(`engine editor: ${editor.url}`);
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)
    process.once(signal, () => {
      void editor.close().finally(() => process.exit(code));
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
