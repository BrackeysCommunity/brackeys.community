/** Creating the canvases an import produced: free names, refusals, bounded retries. */
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { JsonCanvas } from "@/lib/canvas/json-canvas";

import { createImportedCanvases } from "../import-flow";

const createCanvas = vi.hoisted(() => vi.fn());
vi.mock("@/orpc/client", () => ({ client: { createCanvas } }));

describe("creating the imported canvases", () => {
  const final = (targetPath: string) => ({
    sourcePath: targetPath,
    targetPath,
    canvas: { nodes: [], edges: [] } as JsonCanvas,
    docFields: {},
    state: new Uint8Array([0, 0]),
    nodeCount: 0,
  });

  beforeEach(() => {
    createCanvas.mockReset();
  });

  it("takes the next free name when a path was taken meanwhile", async () => {
    const taken = new Set(["plan.canvas", "plan 2.canvas"]);
    createCanvas.mockImplementation(async ({ path }: { path: string }) => {
      if (taken.has(path.toLowerCase()))
        throw Object.assign(new Error("taken"), { code: "CONFLICT" });
      taken.add(path.toLowerCase());
      return { id: `id-${path}`, path };
    });
    const out = await createImportedCanvases([final("Plan.canvas")], {
      scope: { kind: "personal" },
      source: "obsidian_zip",
    });
    expect(out.skipped).toEqual([]);
    expect(out.created.map((c) => c.path)).toEqual(["Plan 3.canvas"]);
    expect(createCanvas).toHaveBeenCalledWith(
      expect.objectContaining({ source: "obsidian_zip", initialState: expect.any(String) }),
    );
  });

  it("reports a refusal (the personal cap) and carries on with the rest", async () => {
    createCanvas.mockImplementation(async ({ path }: { path: string }) => {
      if (path === "A.canvas")
        throw Object.assign(new Error("You have 100 canvases."), { code: "FORBIDDEN" });
      return { id: "id", path };
    });
    const out = await createImportedCanvases([final("A.canvas"), final("B.canvas")], {
      scope: { kind: "personal" },
      source: "obsidian_folder",
    });
    expect(out.created.map((c) => c.path)).toEqual(["B.canvas"]);
    expect(out.skipped).toEqual([{ path: "A.canvas", reason: "You have 100 canvases." }]);
  });

  it("gives up after a bounded number of conflicts", async () => {
    createCanvas.mockRejectedValue(Object.assign(new Error("taken"), { code: "CONFLICT" }));
    const out = await createImportedCanvases([final("P.canvas")], {
      scope: { kind: "personal" },
      source: "obsidian_canvas",
    });
    expect(out.created).toEqual([]);
    expect(out.skipped).toHaveLength(1);
    expect(createCanvas.mock.calls.length).toBeLessThanOrEqual(6);
  });
});
