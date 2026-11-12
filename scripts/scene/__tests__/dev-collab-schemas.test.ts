// @vitest-environment node
import { fileURLToPath } from "node:url";

import { runnerImport } from "vite-plus";
import { describe, expect, it } from "vite-plus/test";

import { engineSourceRunner } from "../../engine-source-alias";

const FIXTURE = fileURLToPath(new URL("./fixtures/dev-collab/schema-hashes.ts", import.meta.url));

describe("the dev collab server's schemas", () => {
  it("converts every kind of every project, games included, through the dev server's runner", async () => {
    const { module } = await runnerImport<typeof import("./fixtures/dev-collab/schema-hashes")>(
      FIXTURE,
      engineSourceRunner,
    );
    const hashes = module.devSchemaHashes;
    expect(Object.keys(hashes)).toEqual(["engine", "platformer", "stress", "tactics"]);
    for (const id of ["platformer", "stress", "tactics"]) {
      expect(hashes[id]).toHaveProperty("scene");
      expect(hashes[id]).toHaveProperty("prefab");
      expect(hashes[id]).toHaveProperty("recording");
    }
  }, 120_000);
});
