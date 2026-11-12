// @vitest-environment node
import { fileURLToPath } from "node:url";

import { createServer, type ViteDevServer } from "vite-plus";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import siteConfig from "../../vite.config.ts";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const ENGINE = `${REPO}packages/engine/`;

/**
 * Importers the tsconfig covers and ones it doesn't: a `.js` or `.mjs` file
 * and a file under `node_modules` resolve `@jams/engine` through its package
 * exports, which name the packed `dist`, unless the site's alias catches it.
 */
const CASES: { id: string; importer: string; source: string }[] = [
  { id: "@jams/engine", importer: "src/routes/index.tsx", source: "index.ts" },
  { id: "@jams/engine/scene", importer: "src/games/platformer/index.ts", source: "scene/index.ts" },
  {
    id: "@jams/engine/game",
    importer: "packages/engine/headless/index.ts",
    source: "game/index.ts",
  },
  { id: "@jams/engine/scene", importer: "src/lib/engine/probe.js", source: "scene/index.ts" },
  { id: "@jams/engine", importer: "src/lib/engine/probe.mjs", source: "index.ts" },
  {
    id: "@jams/engine/project",
    importer: "node_modules/@jams/engine/dist/vite.mjs",
    source: "project/index.ts",
  },
  {
    id: "@jams/engine/editor-ui/style.css",
    importer: "src/styles/editor-ui.css",
    source: "editor-ui/style.css",
  },
  // A file subpath is the package's own export, never a module's index.ts.
  {
    id: "@jams/engine/schemas/scene.schema.json",
    importer: "src/lib/engine/probe.ts",
    source: "scene/scene.schema.json",
  },
];

describe("the site's resolution of @jams/engine", () => {
  let server: ViteDevServer;

  beforeAll(async () => {
    const noScan = { noDiscovery: true, entries: [] };
    server = await createServer({
      configFile: false,
      root: REPO,
      logLevel: "error",
      appType: "custom",
      resolve: siteConfig.resolve,
      optimizeDeps: noScan,
      ssr: { optimizeDeps: noScan },
      server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    });
  }, 60_000);

  afterAll(() => server?.close());

  for (const environment of ["ssr", "client"] as const)
    it(`reaches the engine's source, never dist, in ${environment}`, async () => {
      const env = server.environments[environment];
      expect(env).toBeDefined();
      const resolved: Record<string, string | null> = {};
      const want: Record<string, string> = {};
      for (const { id, importer, source } of CASES) {
        const key = `${id} from ${importer}`;
        const hit = await env!.pluginContainer.resolveId(id, `${REPO}${importer}`);
        resolved[key] = hit ? hit.id.replace(REPO, "") : null;
        want[key] = `${ENGINE}${source}`.replace(REPO, "");
      }
      expect(resolved).toEqual(want);
    });
});
