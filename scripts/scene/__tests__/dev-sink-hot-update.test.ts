// @vitest-environment node
import { readFileSync } from "node:fs";
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
      expect(data(at("src/games/tactics/art/tiles.png"))).toBe(true);
      expect(data(at("src/games/tactics/art/tiles.png.asset.json"))).toBe(true);
      expect(data(at("src/games/tactics/art/make-art.ts"))).toBe(false);
      expect(data(at("src/games/platformer/scene.schema.json"))).toBe(false);
      expect(data(at("src/games/platformer/jams.project.json"))).toBe(false);
      expect(data(at("packages/engine/scenes/jams.project.json"))).toBe(false);
      expect(data(at("packages/engine/scene/scene.schema.json"))).toBe(false);
      expect(data(at("src/games/platformer/index.ts"))).toBe(false);
      expect(data(at("src/components/game/GameCanvas.tsx"))).toBe(false);
      expect(data(at("src/styles.css"))).toBe(false);
    },
  );

  // The config itself isn't imported: building it constructs every site plugin.
  it("filters edits through Vite's hotUpdate, for updates only, with the same predicate", () => {
    const config = readFileSync(at("vite.config.ts"), "utf8");
    expect(config).not.toContain("handleHotUpdate");
    expect(config).toContain(
      'hotUpdate({ type, file }) {\n      return type === "update" && isProjectData?.(file) ? [] : undefined;',
    );
    expect(config).toContain("isProjectData = (file) => module.isDevProjectData(file);");
  });
});
