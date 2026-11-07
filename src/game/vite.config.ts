import { defineConfig, type UserConfig } from "vite-plus";

type PackConfig = Extract<NonNullable<UserConfig["pack"]>, unknown[]>[number];

const peers = [
  "pixi.js",
  "@tanstack/store",
  "zod",
  "@dimforge/rapier2d",
  "@dimforge/rapier2d-compat",
];

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
      entry: {
        index: "./index.ts",
        scene: "./scene/index.ts",
        editor: "./editor/index.ts",
        headless: "./headless/index.ts",
        debug: "./debug/index.ts",
      },
    },
    {
      ...shared,
      platform: "node",
      tsconfig: "./tsconfig.pack.node.json",
      clean: false,
      entry: { vite: "./vite/index.ts" },
    },
  ],
});
