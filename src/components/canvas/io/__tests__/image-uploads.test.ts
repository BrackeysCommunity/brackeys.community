/**
 * An import's images: matched against the scope, uploaded three at a time,
 * failures and unsupported types reported, duplicates sharing one upload,
 * and a re-import into the same scope uploading nothing.
 */
import { describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { canvasNodes, docToJsonCanvas } from "@/lib/canvas/json-canvas";

import { runImportJob } from "../canvas-io-jobs";
import { eachLimited, type ImageUploader, resolveImages } from "../import-flow";
import { zipVault } from "../vault-zip";
import { docOf, exportCanvas, exportVault, importFiles, syntheticVault } from "./import-harness";
import { enc, memoryScope, PNG } from "./vault-fixtures";

vi.mock("@/orpc/client", () => ({ client: {} }));

const fileNode = (id: string, file: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: "file",
  file,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
  ...extra,
});
const canvasBytes = (nodes: object[], edges: object[] = []) =>
  enc(JSON.stringify({ nodes, edges }));

function importEntries(entries: { path: string; bytes: Uint8Array }[], uploader?: ImageUploader) {
  const scope = memoryScope();
  return importFiles(uploader ? { ...scope, uploader } : scope, entries);
}

async function prepared(paths: string[]) {
  const nodes = paths.map((p, i) => fileNode(`n${i}`, p));
  const result = await runImportJob({
    source: {
      files: [
        { path: "Board.canvas", file: new Blob([enc(JSON.stringify({ nodes, edges: [] }))]) },
        ...paths.map((p) => ({ path: p, file: new Blob([PNG]) })),
      ],
    },
    options: { mode: "new" },
  });
  if (result.kind !== "import") throw new Error("expected an import");
  return result;
}

describe("uploading an import's images", () => {
  function images(count: number) {
    const nodes = Array.from({ length: count }, (_, i) => fileNode(`i${i}`, `img/${i}.png`));
    return [
      { path: "c.canvas", bytes: canvasBytes(nodes) },
      // Distinct bytes, so nothing dedupes.
      ...nodes.map((n, i) => ({ path: n.file, bytes: new Uint8Array([...PNG, i]) })),
    ];
  }

  it("never runs more than three at once", async () => {
    let active = 0;
    let peak = 0;
    const uploader: ImageUploader = {
      match: async () => ({ byId: {}, bySha: {} }),
      upload: async (_file, path) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return { id: path, path, url: `/images/${path}` };
      },
    };
    const { images: done } = await importEntries(images(10), uploader);
    expect(done.uploaded).toBe(10);
    expect(peak).toBe(3);
  });

  it("a failed upload is reported and its card keeps the 'not included' file state", async () => {
    const uploader: ImageUploader = {
      match: async () => ({ byId: {}, bySha: {} }),
      upload: async (_file, path) => {
        if (path === "img/1.png") throw new Error("Rate limited.");
        return { id: `id-${path}`, path, url: `/images/${path}` };
      },
    };
    const { images: done, finals } = await importEntries(images(3), uploader);
    expect(done.uploaded).toBe(2);
    expect(done.skipped).toEqual([{ path: "img/1.png", reason: "Rate limited." }]);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, finals[0]!.state);
    const types = Object.fromEntries(
      [...canvasNodes(doc).entries()].map(([id, n]) => [id, (n as Y.Map<unknown>).get("type")]),
    );
    expect(types).toEqual({ i0: "image", i1: "file", i2: "image" });
  });

  it("a duplicate whose first copy failed to upload is reported, not silently dropped", async () => {
    const uploader: ImageUploader = {
      match: async () => ({ byId: {}, bySha: {} }),
      upload: async () => {
        throw new Error("Rate limited.");
      },
    };
    const { images: done } = await importEntries(
      [
        { path: "c.canvas", bytes: canvasBytes([fileNode("a", "a.png"), fileNode("b", "b.png")]) },
        { path: "a.png", bytes: PNG },
        { path: "b.png", bytes: PNG },
      ],
      uploader,
    );
    expect(done.skipped.map((s) => s.path).sort()).toEqual(["a.png", "b.png"]);
    expect(done.skipped.find((s) => s.path === "b.png")!.reason).toMatch(/a\.png/);
  });

  it("an image found in the scope at another path is listed as a repair", async () => {
    const upload = vi.fn();
    const scope = memoryScope();
    await scope.uploader.upload(new File([PNG], "x.png"), "Elsewhere/x.png");
    const result = await runImportJob({
      source: {
        files: [
          { path: "c.canvas", file: new Blob([canvasBytes([fileNode("a", "Art/a.png")])]) },
          { path: "Art/a.png", file: new Blob([PNG]) },
        ],
      },
      options: { mode: "new" },
    });
    if (result.kind !== "import") throw new Error("expected an import");
    const done = await resolveImages(result.canvases, result.images, { ...scope.uploader, upload });
    expect(upload).not.toHaveBeenCalled();
    expect(done.repairs).toEqual([
      expect.objectContaining({ from: "Art/a.png", to: "Elsewhere/x.png" }),
    ]);
  });

  it("a keyed image whose bytes changed outside the site is uploaded, not swapped for the old one", async () => {
    const scope = memoryScope();
    const old = await scope.uploader.upload(new File([PNG], "a.png"), "a.png");
    const edited = new Uint8Array([...PNG, 7]);
    const result = await runImportJob({
      source: {
        files: [
          {
            path: "c.canvas",
            file: new Blob([
              canvasBytes([
                fileNode("a", "a.png", { jamsTeam: { type: "image", attachmentId: old.id } }),
              ]),
            ]),
          },
          { path: "a.png", file: new Blob([edited]) },
        ],
      },
      options: { mode: "new" },
    });
    if (result.kind !== "import") throw new Error("expected an import");
    const done = await resolveImages(result.canvases, result.images, scope.uploader);
    expect(done.uploaded).toBe(1);
    expect(done.reused).toBe(0);
    const landed = [...done.resolved.values()][0]!;
    expect(landed.attachmentId).not.toBe(old.id);
    expect(done.repairs).toEqual([expect.objectContaining({ from: "a.png", to: "a 2.png" })]);
  });

  it("a keyed image with the same bytes reuses its attachment", async () => {
    const scope = memoryScope();
    const old = await scope.uploader.upload(new File([PNG], "a.png"), "a.png");
    const result = await runImportJob({
      source: {
        files: [
          {
            path: "c.canvas",
            file: new Blob([
              canvasBytes([
                fileNode("a", "a.png", { jamsTeam: { type: "image", attachmentId: old.id } }),
              ]),
            ]),
          },
          { path: "a.png", file: new Blob([PNG]) },
        ],
      },
      options: { mode: "new" },
    });
    if (result.kind !== "import") throw new Error("expected an import");
    const done = await resolveImages(result.canvases, result.images, scope.uploader);
    expect(done.uploaded).toBe(0);
    expect([...done.resolved.values()][0]!.attachmentId).toBe(old.id);
    expect(done.repairs).toEqual([]);
  });

  it("a match call that fails fails the import before any upload", async () => {
    const upload = vi.fn();
    const uploader: ImageUploader = {
      match: async () => {
        throw new Error("offline");
      },
      upload,
    };
    await expect(importEntries(images(2), uploader)).rejects.toThrow("offline");
    expect(upload).not.toHaveBeenCalled();
  });

  it("an unsupported image type is reported, not uploaded", async () => {
    const upload = vi.fn();
    const uploader: ImageUploader = { match: async () => ({ byId: {}, bySha: {} }), upload };
    const { images: done } = await importEntries(
      [
        { path: "c.canvas", bytes: canvasBytes([fileNode("s", "x.svg"), fileNode("b", "x.bmp")]) },
        { path: "x.svg", bytes: enc("<svg/>") },
        { path: "x.bmp", bytes: enc("BM") },
      ],
      uploader,
    );
    expect(upload).not.toHaveBeenCalled();
    expect(done.skipped.map((s) => s.path).sort()).toEqual(["x.bmp", "x.svg"]);
  });

  it("eachLimited runs every item even when tasks finish out of order", async () => {
    const seen: number[] = [];
    await eachLimited([30, 1, 20, 2, 10], 2, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      seen.push(i);
    });
    expect(seen.sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("duplicate images", () => {
  it("three copies of one image: when the shared upload fails, every copy is reported", async () => {
    const result = await prepared(["a/x.png", "b/y.png", "c/z.png"]);
    const scope = memoryScope();
    const upload = vi.fn(async () => {
      throw new Error("Upload refused.");
    });
    const uploader: ImageUploader = {
      match: (input) => scope.uploader.match(input),
      upload,
    };
    const out = await resolveImages(result.canvases, result.images, uploader);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(out.resolved.size).toBe(0);
    const reported = new Set(out.skipped.map((s) => s.path));
    for (const image of result.images) expect(reported.has(image.path)).toBe(true);
  });

  it("copies follow the first upload to its repaired path, each with its own repair line", async () => {
    const result = await prepared(["a/x.png", "b/y.png"]);
    const scope = memoryScope();
    // The scope already holds a different picture at the first path.
    await scope.uploader.upload(
      new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" }),
      "a/x.png",
    );
    const out = await resolveImages(result.canvases, result.images, scope.uploader);
    expect(out.uploaded).toBe(1);
    const landed = [...out.resolved.values()].map((r) => r.path);
    expect(new Set(landed)).toEqual(new Set(["a/x 2.png"]));
    expect(
      out.repairs.map((r) => `${r.from} -> ${r.to}`).sort((a, b) => a.localeCompare(b)),
    ).toEqual(["a/x.png -> a/x 2.png", "b/y.png -> a/x 2.png"]);
  });

  it("lists a repair when two paths with the same bytes share one upload", async () => {
    const scope = memoryScope();
    const canvas = {
      nodes: [
        { id: "a", type: "file", file: "Art/one.png", x: 0, y: 0, width: 10, height: 10 },
        { id: "b", type: "file", file: "Other/two.png", x: 50, y: 0, width: 10, height: 10 },
      ],
    };
    const { finals, result, images } = await importFiles(scope, [
      { path: "c.canvas", bytes: enc(JSON.stringify(canvas)) },
      { path: "Art/one.png", bytes: PNG },
      { path: "Other/two.png", bytes: PNG },
    ]);
    const exported = exportVault(scope, finals).files;
    const listed = [...result.report.repairs, ...images.repairs].map((r) => r.from);
    expect(exported.has("Other/two.png") || listed.includes("Other/two.png")).toBe(true);
  });
});

describe("re-importing into the same scope", () => {
  it("dedupes plain images by sha256 and creates no attachment rows", async () => {
    const scope = memoryScope();
    const first = await importFiles(scope, zipVault(syntheticVault()));
    const rows = scope.rows.length;
    expect(rows).toBeGreaterThan(0);
    const { files } = exportVault(scope, first.finals);
    const zip = zipVault([...files].map(([path, bytes]) => ({ path, bytes })));

    const upload = vi.spyOn(scope.uploader, "upload");
    const again = await importFiles(scope, zip);
    expect(upload).not.toHaveBeenCalled();
    expect(again.images.uploaded).toBe(0);
    expect(again.images.reused).toBe(rows);
    expect(scope.rows.length).toBe(rows);

    // And a third time, from the second import's export.
    const third = await importFiles(
      scope,
      zipVault(
        [...exportVault(scope, again.finals).files].map(([path, bytes]) => ({ path, bytes })),
      ),
    );
    expect(third.images.uploaded).toBe(0);
    expect(scope.rows.length).toBe(rows);
  });

  it("reuses keyed images by attachment id (the .canvas export keeps the key)", async () => {
    const scope = memoryScope();
    const first = await importFiles(scope, zipVault(syntheticVault()));
    const board = first.finals.find((f) => f.targetPath === "Boards/Board.canvas")!;
    // The .canvas export (not the vault zip) keeps the image key on every image card.
    const canvasFile = exportCanvas(board.state);
    expect(canvasFile).toContain('"jamsTeam"');
    const upload = vi.spyOn(scope.uploader, "upload");
    const match = vi.spyOn(scope.uploader, "match");
    const again = await importFiles(scope, [{ path: "Board.canvas", bytes: enc(canvasFile) }]);
    expect(upload).not.toHaveBeenCalled();
    expect(match.mock.calls[0]![0].attachmentIds.length).toBeGreaterThan(0);
    const out = docToJsonCanvas(docOf(again.finals[0]!.state));
    const images = out.nodes.filter((n) => n.jamsTeam?.type === "image");
    expect(images.length).toBe(4);
    const ids = new Set(scope.rows.map((r) => r.id));
    for (const n of images)
      expect(ids.has((n.jamsTeam as { attachmentId: string }).attachmentId)).toBe(true);
  });
});
