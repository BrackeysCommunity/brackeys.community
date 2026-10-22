/**
 * Oversize imports are refused up front, with the numbers, before anything
 * is matched, uploaded or created.
 */
import { zipSync } from "fflate";
import { describe, expect, it, vi } from "vite-plus/test";

import { CANVAS_IMPORT_LIMITS, CANVAS_LIMITS } from "@/lib/canvas/limits";

import { runImportJob } from "../canvas-io-jobs";
import { ImportRefusedError, type VaultImportOptions } from "../vault-import";
import { unzipVault } from "../vault-zip";
import { importFiles } from "./import-harness";
import { enc, memoryScope, PNG } from "./vault-fixtures";

vi.mock("@/orpc/client", () => ({ client: {} }));

function spyScope() {
  const scope = memoryScope();
  const upload = vi.spyOn(scope.uploader, "upload");
  const match = vi.spyOn(scope.uploader, "match");
  return { scope, upload, match };
}

async function refusedWith(
  files: { path: string; bytes: Uint8Array }[] | Uint8Array,
  options: VaultImportOptions = { mode: "new" },
) {
  const { scope, upload, match } = spyScope();
  const error = await importFiles(scope, files, options).then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ImportRefusedError);
  // Refused before matching, uploading or anything that creates a canvas.
  expect(match).not.toHaveBeenCalled();
  expect(upload).not.toHaveBeenCalled();
  return error as ImportRefusedError;
}

const textCanvas = (count: number, text = "") =>
  enc(
    JSON.stringify({
      nodes: Array.from({ length: count }, (_, i) => ({
        id: `n${i}`,
        type: "text",
        text,
        x: i,
        y: 0,
        width: 10,
        height: 10,
      })),
    }),
  );

describe("import limits", () => {
  it("more than maxNodes cards on a new canvas", async () => {
    const error = await refusedWith([
      { path: "big.canvas", bytes: textCanvas(CANVAS_LIMITS.maxNodes + 1) },
      { path: "a.png", bytes: PNG },
    ]);
    expect([error.limit, error.actual, error.max]).toEqual(["maxNodes", 2_001, 2_000]);
    expect(error.message).toContain("2,001");
    expect(error.message).toContain("2,000");
  });

  it("exactly maxNodes cards is fine", async () => {
    const { scope } = spyScope();
    const { finals } = await importFiles(scope, [
      { path: "big.canvas", bytes: textCanvas(CANVAS_LIMITS.maxNodes) },
    ]);
    expect(finals[0]!.nodeCount).toBe(CANVAS_LIMITS.maxNodes);
  });

  it("more than maxNodes cards counted with what the open canvas already holds", async () => {
    const error = await refusedWith([{ path: "b.canvas", bytes: textCanvas(11) }], {
      mode: "into",
      existing: { nodes: CANVAS_LIMITS.maxNodes - 10, stateBytes: 0 },
    });
    expect(error.limit).toBe("maxNodes");
    expect(error.actual).toBe(CANVAS_LIMITS.maxNodes + 1);
  });

  it("several canvases imported into one open canvas count together", async () => {
    const error = await refusedWith(
      [
        { path: "a.canvas", bytes: textCanvas(1_000) },
        { path: "b.canvas", bytes: textCanvas(1_001) },
      ],
      { mode: "into", existing: { nodes: 0, stateBytes: 0 } },
    );
    expect(error.limit).toBe("maxNodes");
    expect(error.actual).toBe(2_001);
  });

  it("more than maxStateBytes of state", async () => {
    // Under every per-card cap, over the state cap.
    const error = await refusedWith([
      { path: "s.canvas", bytes: textCanvas(300, "x".repeat(19_000)) },
    ]);
    expect(error.limit).toBe("maxStateBytes");
    expect(error.actual).toBeGreaterThan(CANVAS_LIMITS.maxStateBytes);
    expect(error.message).toMatch(/MB/);
  });

  it("more than maxStateBytes once note bodies are attached", async () => {
    const nodes = Array.from({ length: 6 }, (_, i) => ({
      id: `f${i}`,
      type: "file",
      file: `n${i}.md`,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    }));
    const error = await refusedWith([
      { path: "c.canvas", bytes: enc(JSON.stringify({ nodes })) },
      ...nodes.map((n) => ({ path: n.file, bytes: enc("y".repeat(1_000_000)) })),
    ]);
    expect(error.limit).toBe("maxStateBytes");
  });

  it("more than maxFiles entries (picked files)", async () => {
    const files = Array.from({ length: CANVAS_IMPORT_LIMITS.maxFiles + 1 }, (_, i) => ({
      path: `n${i}.md`,
      bytes: new Uint8Array(),
    }));
    const error = await refusedWith(files);
    expect(error.limit).toBe("maxFiles");
    expect(error.message).toContain("5,001");
    expect(error.message).toContain("5,000");
  });

  it("more than maxFiles entries (zip), skipped junk not counted", async () => {
    const tree: Record<string, Uint8Array> = {};
    for (let i = 0; i < CANVAS_IMPORT_LIMITS.maxFiles; i++) tree[`n${i}.md`] = new Uint8Array();
    for (let i = 0; i < 50; i++) tree[`.obsidian/p${i}.json`] = new Uint8Array();
    // At the cap with junk alongside: fine.
    expect(unzipVault(zipSync(tree, { level: 0 })).entries).toHaveLength(
      CANVAS_IMPORT_LIMITS.maxFiles,
    );
    tree["one-more.md"] = new Uint8Array();
    const error = await refusedWith(zipSync(tree, { level: 0 }));
    expect(error.limit).toBe("maxFiles");
    expect(error.message).toContain("5,001 files");
  });

  it("more than maxUnzippedBytes: a zip whose directory declares too much is refused before inflating", async () => {
    const zip = zipSync({ "a.md": enc("a"), "b.md": enc("b"), "c.md": enc("c") }, { level: 0 });
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const third = Math.floor(CANVAS_IMPORT_LIMITS.maxUnzippedBytes / 3) + 1;
    for (let i = 0; i < zip.length - 4; i++) {
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, third, true);
    }
    const error = await refusedWith(zip);
    expect(error.limit).toBe("maxUnzippedBytes");
    expect(error.actual).toBe(third * 3);
    expect(error.message).toMatch(/500 MB/);
  });

  it("more than maxUnzippedBytes: picked files are refused from their sizes, before reading", async () => {
    const big = { size: CANVAS_IMPORT_LIMITS.maxUnzippedBytes + 1 } as Blob;
    const read = vi.fn();
    Object.defineProperty(big, "arrayBuffer", { value: read });
    const error = await runImportJob({
      source: { files: [{ path: "huge.md", file: big }] },
      options: { mode: "new" },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportRefusedError);
    expect((error as ImportRefusedError).limit).toBe("maxUnzippedBytes");
    expect(read).not.toHaveBeenCalled();
  });

  it("more than maxImagesPerImport images", async () => {
    const count = CANVAS_IMPORT_LIMITS.maxImagesPerImport + 1;
    const nodes = Array.from({ length: count }, (_, i) => ({
      id: `i${i}`,
      type: "file",
      file: `img/${i}.png`,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    }));
    const error = await refusedWith([
      { path: "c.canvas", bytes: enc(JSON.stringify({ nodes })) },
      ...nodes.map((n) => ({ path: n.file, bytes: PNG })),
    ]);
    expect([error.limit, error.actual, error.max]).toEqual([
      "maxImagesPerImport",
      count,
      CANVAS_IMPORT_LIMITS.maxImagesPerImport,
    ]);
    expect(error.message).toContain("201");
    expect(error.message).toContain("200");
  });

  it("images counted across every selected canvas, not per canvas", async () => {
    const half = CANVAS_IMPORT_LIMITS.maxImagesPerImport / 2 + 1;
    const canvasWith = (from: number) =>
      enc(
        JSON.stringify({
          nodes: Array.from({ length: half }, (_, i) => ({
            id: `i${i}`,
            type: "file",
            file: `img/${from + i}.png`,
            x: 0,
            y: 0,
            width: 10,
            height: 10,
          })),
        }),
      );
    const error = await refusedWith([
      { path: "a.canvas", bytes: canvasWith(0) },
      { path: "b.canvas", bytes: canvasWith(half) },
      ...Array.from({ length: half * 2 }, (_, i) => ({ path: `img/${i}.png`, bytes: PNG })),
    ]);
    expect(error.limit).toBe("maxImagesPerImport");
    expect(error.actual).toBe(half * 2);
  });

  it("more than maxZipBytes", async () => {
    const zip = new Uint8Array(CANVAS_IMPORT_LIMITS.maxZipBytes + 1);
    expect(() => unzipVault(zip)).toThrow(ImportRefusedError);
  });
});
