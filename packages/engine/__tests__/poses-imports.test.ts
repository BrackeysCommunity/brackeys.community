// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vite-plus/test";

const POSES = fileURLToPath(new URL("../runtime/poses.ts", import.meta.url));

describe("runtime/poses.ts", () => {
  it("imports and re-exports nothing but types, so the pose index stays free of physics and schema", () => {
    const source = readFileSync(POSES, "utf8");
    const statements = source.match(/^(?:import|export)\b[^;]*?\bfrom\s+["'][^"']+["']/gm) ?? [];
    const valueEdges = statements.filter((s) => !/^(?:import|export)\s+type\b/.test(s));
    expect(valueEdges).toEqual([]);
  });
});
