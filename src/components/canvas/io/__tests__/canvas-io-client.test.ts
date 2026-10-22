import { describe, expect, it } from "vite-plus/test";

import { canvasIoUsesWorker, runCanvasIo } from "../canvas-io-client";
import { importVault } from "../vault-import";
import { zipVault } from "../vault-zip";
import { entry, PNG } from "./vault-fixtures";

describe("canvas-io client without a Worker", () => {
  it("runs the import in the page with the core's result", async () => {
    expect(canvasIoUsesWorker()).toBe(false);
    const canvas = JSON.stringify({
      nodes: [{ id: "a", type: "file", file: "a.png", x: 0, y: 0, width: 1, height: 1 }],
      edges: [],
    });
    const entries = [entry("C.canvas", canvas), entry("a.png", PNG)];
    const progress: string[] = [];
    const result = await runCanvasIo(
      "import",
      {
        source: { zip: new Blob([zipVault(entries) as Uint8Array<ArrayBuffer>]) },
        options: { mode: "new" },
      },
      (p) => progress.push(p.phase),
    );
    if (result.kind !== "import") throw new Error("expected an import");
    const core = importVault(entries, { mode: "new" });
    expect(result.report).toEqual(core.report);
    expect(result.canvases.map((c) => c.canvas)).toEqual(core.canvases.map((c) => c.canvas));
    expect(result.images[0]).toMatchObject({ path: "a.png", uploadPath: "a.png", error: null });
    expect(result.images[0]!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(progress).toContain("unzipping");
  });

  it("refuses with the core's error", async () => {
    await expect(
      runCanvasIo("import", {
        source: {
          files: Array.from({ length: 5_001 }, (_, i) => ({ path: `${i}.md`, file: new Blob([]) })),
        },
        options: { mode: "new" },
      }),
    ).rejects.toMatchObject({ name: "ImportRefusedError", limit: "maxFiles" });
  });

  it("exports a zip, reporting images it couldn't fetch", async () => {
    const { zip, leftOut } = await runCanvasIo("export", {
      files: [
        { path: "Plan.canvas", bytes: new TextEncoder().encode("{}") },
        { path: "a.png", url: "http://127.0.0.1:1/never" },
      ],
    });
    expect(zip.length).toBeGreaterThan(0);
    expect(leftOut).toEqual([{ path: "a.png", reason: "The image couldn't be downloaded." }]);
  });
});
