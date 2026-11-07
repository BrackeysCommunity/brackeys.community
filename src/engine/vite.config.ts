import { defineConfig, type UserConfig } from "vite-plus";

type PackConfig = Extract<NonNullable<UserConfig["pack"]>, unknown[]>[number];

const peers = [
  "pixi.js",
  "@tanstack/store",
  "zod",
  "@dimforge/rapier2d",
  "@dimforge/rapier2d-compat",
  "yjs",
  "fractional-indexing",
  "@hocuspocus/server",
];

/**
 * `vp run engine:pack:check` sets this to run publint, attw and the unused-peer
 * check as errors; a plain `engine:pack` skips them.
 */
const check = process.env.ENGINE_PACK_CHECK === "1";

/** Peers a host supplies that the package never imports: `-compat` is the Bun/Node flavour a host injects. */
const hostOnlyPeers = ["@dimforge/rapier2d-compat"];

const shared: PackConfig = {
  format: "esm",
  dts: true,
  sourcemap: true,
  fixedExtension: true,
  outDir: "dist",
  tsconfig: "./tsconfig.pack.json",
  deps: { neverBundle: [...peers, /^node:/] },
};

export default defineConfig({
  pack: [
    {
      ...shared,
      platform: "neutral",
      // Package-level checks run once, on the tarball; the second config would repeat them.
      publint: check && { level: "suggestion", strict: true },
      attw: check && { profile: "esm-only", level: "error" },
      unused: check && {
        level: "error",
        ignore: { peerDependencies: [...hostOnlyPeers, "@hocuspocus/server"] },
      },
      entry: {
        index: "./index.ts",
        scene: "./scene/index.ts",
        editor: "./editor/index.ts",
        collab: "./collab/index.ts",
        headless: "./headless/index.ts",
        game: "./game/index.ts",
        debug: "./debug/index.ts",
        "sim-kit": "./sim-kit/index.ts",
      },
    },
    {
      ...shared,
      platform: "node",
      tsconfig: "./tsconfig.pack.node.json",
      clean: false,
      unused: check && { level: "error", ignore: { peerDependencies: hostOnlyPeers } },
      entry: { vite: "./vite/index.ts" },
    },
  ],
});
