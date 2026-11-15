// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { createDebugDrawSink } from "../../packages/engine/debug/draw-sink";
import { createSceneRuntime } from "../../packages/engine/runtime/runtime";
import { debugDrawProblems, noopDebugDrawProblem } from "../engine-bundle-check";
import type { ReportedChunk } from "../engine-bundle-report";

const chunk = (fileName: string, ...modules: string[]): ReportedChunk => ({
  fileName,
  isEntry: false,
  isDynamicEntry: false,
  imports: [],
  dynamicImports: [],
  modules: Object.fromEntries(modules.map((id) => [id, 100])),
});

const RUNTIME = "/repo/packages/engine/runtime/runtime.ts";

describe("engine-bundle-check's ctx.debug check", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** A packed engine chunk whose sourcemap names `sources`, as `game build` bundles it. */
  function packed(name: string, sources: string[]): string {
    const root = mkdtempSync(join(tmpdir(), "bundle-check-"));
    dirs.push(root);
    const dist = join(root, "node_modules/@jams/engine/dist");
    mkdirSync(dist, { recursive: true });
    const id = join(dist, `${name}.mjs`);
    writeFileSync(id, "");
    writeFileSync(`${id}.map`, JSON.stringify({ version: 3, sources, mappings: "" }));
    return id;
  }

  it("passes a build that holds the runtime and no sink, from source or packed", () => {
    expect(debugDrawProblems([chunk("a.js", "/repo/src/x.ts", RUNTIME)])).toEqual([]);
    const store = packed("store-abc", ["../runtime/tree.ts", "../runtime/runtime.ts"]);
    expect(debugDrawProblems([chunk("b.js", store)])).toEqual([]);
  });

  it("fails a build with no runtime, whose ctx.debug the source check can't speak for", () => {
    expect(debugDrawProblems([chunk("a.js", "/repo/src/x.ts")])).toEqual([
      "no chunk holds the scene runtime (packages/engine/runtime/runtime.ts)",
    ]);
  });

  it("fails a build that bundles the debug-draw sink, from source or packed", () => {
    const sink = packed("draw-sink-abc", ["../debug/draw-sink.ts"]);
    const problems = debugDrawProblems([
      chunk("a.js", RUNTIME, "/repo/packages/engine/debug/draw-sink.ts"),
      chunk("b.js", sink),
    ]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("a.js: /repo/packages/engine/debug/draw-sink.ts");
    expect(problems[1]).toMatch(/b\.js: .*draw-sink-abc\.mjs \(from .*debug\/draw-sink\.ts\)/);
  });

  it("finds a sinkless runtime's ctx.debug to be the no-op, and a sink's draw not", () => {
    const runtime = createSceneRuntime({ rapier: null, view: null });
    try {
      expect(noopDebugDrawProblem(runtime.ctx.debug)).toBeNull();
    } finally {
      runtime.destroy();
    }
    const sink = createDebugDrawSink();
    expect(noopDebugDrawProblem(sink.draw)).not.toBeNull();
  });
});
