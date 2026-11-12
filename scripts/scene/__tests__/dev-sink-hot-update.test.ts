// @vitest-environment node
import { fileURLToPath } from "node:url";

import { runnerImport } from "vite-plus";
import { describe, expect, it } from "vite-plus/test";

import { engineSourceRunner } from "../../engine-source-alias";

const SINK = fileURLToPath(new URL("../dev-sink.ts", import.meta.url));
const at = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

describe("the dev server's hot updates", () => {
  it(
    "skips the project data the collab server writes and keeps code and site files",
    { timeout: 60_000 },
    async () => {
      const { module } = await runnerImport<typeof import("../dev-sink")>(SINK, engineSourceRunner);
      const data = module.isDevProjectData;
      expect(data(at("src/games/platformer/scenes/test-yard.json"))).toBe(true);
      expect(data(at("src/games/platformer/scene-list.json"))).toBe(true);
      expect(data(at("packages/engine/scenes/kitchen-sink.json"))).toBe(true);
      expect(data(at("packages/engine/scenes/grid-annex.json.asset.json"))).toBe(true);
      expect(data(at("src/games/platformer/index.ts"))).toBe(false);
      expect(data(at("src/components/game/GameCanvas.tsx"))).toBe(false);
      expect(data(at("src/styles.css"))).toBe(false);
    },
  );
});
