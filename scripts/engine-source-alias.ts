import { fileURLToPath } from "node:url";

const ENGINE = fileURLToPath(new URL("../packages/engine/", import.meta.url));

/**
 * `@jams/engine` and its subpaths resolved to the engine's source, as the
 * tsconfig paths name them. Without it, a module runner resolves them through
 * `node_modules/@jams/engine`'s exports to the packed `dist` whenever one has
 * been built, and `dist/vite.mjs` bundles its own copy of the engine: a game
 * built on `dist/game.mjs` then hands the collab server schemas from another
 * instance.
 */
export const engineSourceAlias = [
  { find: /^@jams\/engine\/editor-ui\/style\.css$/, replacement: `${ENGINE}editor-ui/style.css` },
  { find: /^@jams\/engine$/, replacement: `${ENGINE}index.ts` },
  { find: /^@jams\/engine\/(.+)$/, replacement: `${ENGINE}$1/index.ts` },
];

/** The `runnerImport` config the dev servers load the engine's Node side through. */
export const engineSourceRunner = {
  configFile: false as const,
  resolve: { tsconfigPaths: true, alias: engineSourceAlias },
};
