import { fileURLToPath, URL } from "node:url";

import wasm from "vite-plugin-wasm";
import { defineConfig } from "vite-plus";

const engineRoot = fileURLToPath(new URL("./src/engine", import.meta.url));

export default defineConfig({
  plugins: [wasm()],
  resolve: {
    alias: [
      { find: /^@jams\/engine$/, replacement: `${engineRoot}/index.ts` },
      { find: /^@jams\/engine-testing$/, replacement: `${engineRoot}/__tests__/testing.ts` },
      {
        find: /^@jams\/engine\/editor-ui\/style\.css$/,
        replacement: `${engineRoot}/editor-ui/style.css`,
      },
      { find: /^@jams\/engine\/(.+)$/, replacement: `${engineRoot}/$1/index.ts` },
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
      {
        find: "@dimforge/rapier2d",
        replacement: fileURLToPath(
          new URL("./node_modules/@dimforge/rapier2d/rapier.js", import.meta.url),
        ),
      },
    ],
  },
  test: {
    include: [
      "src/**/__tests__/**/*.test.{ts,tsx}",
      "scripts/scene/**/__tests__/**/*.test.ts",
      "scripts/engine-readme/**/__tests__/**/*.test.ts",
      "scripts/engine-smoke/__tests__/**/*.test.ts",
    ],
    environment: "node",
    globalSetup: ["./src/test/global-setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["lcov", "text", "cobertura"],
      reportsDirectory: "./coverage",
    },
  },
});
