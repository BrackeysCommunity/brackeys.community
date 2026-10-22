/**
 * Edge cases around the import and export core: malformed input, hostile
 * zips, upload failures and concurrency, name collisions on create, and the
 * worker protocol.
 */
import { zipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { canvasNodes, docToJsonCanvas, type JsonCanvas } from "@/lib/canvas/json-canvas";

import { runImportJob, runExportJob } from "../canvas-io-jobs";
import { deserializeIoError, serializeIoError, transferablesOf } from "../canvas-io-protocol";
import {
  createImportedCanvases,
  eachLimited,
  finalizeCanvases,
  type ImageUploader,
  resolveImages,
} from "../import-flow";
import { buildVaultExport } from "../vault-export";
import { importVault, ImportRefusedError, refusal, VaultResolver } from "../vault-import";
import { cleanZipPath, unzipVault, zipVault } from "../vault-zip";
import { enc, entry, memoryScope, PNG } from "./vault-fixtures";

const createCanvas = vi.hoisted(() => vi.fn());
vi.mock("@/orpc/client", () => ({ client: { createCanvas } }));

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

async function importEntries(
  entries: { path: string; bytes: Uint8Array }[],
  uploader?: ImageUploader,
) {
  const result = await runImportJob({
    source: {
      files: entries.map((e) => ({
        path: e.path,
        file: new Blob([e.bytes as Uint8Array<ArrayBuffer>]),
      })),
    },
    options: { mode: "new" },
  });
  if (result.kind !== "import") throw new Error("expected an import");
  const scope = memoryScope();
  const images = await resolveImages(result.canvases, result.images, uploader ?? scope.uploader);
  return {
    result,
    images,
    finals: finalizeCanvases(result.canvases, result.images, images.resolved),
  };
}

describe("malformed canvases", () => {
  it.each([
    ["not JSON", enc("{nodes: [")],
    ["JSON array", enc("[]")],
    ["nodes not an array", enc('{"nodes": 5}')],
    ["Latin-1 bytes", new Uint8Array([0x7b, 0xe9, 0x7d])],
    ["empty file", new Uint8Array()],
  ])("%s is reported, not thrown, and the rest still imports", (_label, bytes) => {
    const out = importVault(
      [entry("bad.canvas", bytes), entry("good.canvas", canvasBytes([fileNode("a", "x.md")]))],
      { mode: "new" },
    );
    expect(out.canvases.map((c) => c.sourcePath)).toContain("good.canvas");
    if (!out.canvases.some((c) => c.sourcePath === "bad.canvas")) {
      expect(out.report.skipped.find((s) => s.path === "bad.canvas")?.reason).toMatch(
        /JSON Canvas/,
      );
    }
  });

  it("drops edges to missing nodes and duplicate ids instead of failing", () => {
    const out = importVault(
      [
        entry(
          "c.canvas",
          canvasBytes(
            [
              { id: "a", type: "text", text: "a", x: 0, y: 0, width: 1, height: 1 },
              { id: "a", type: "text", text: "dup", x: 0, y: 0, width: 1, height: 1 },
              { id: "b", type: "weird", x: 0, y: 0, width: 1, height: 1 },
            ],
            [
              { id: "e", fromNode: "a", toNode: "ghost" },
              { id: "f", fromNode: "a", toNode: "a" },
            ],
          ),
        ),
      ],
      { mode: "new" },
    );
    const doc = new Y.Doc();
    Y.applyUpdate(doc, out.canvases[0]!.state);
    const json = docToJsonCanvas(doc);
    expect(json.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(json.edges.map((e) => e.id)).toEqual(["f"]);
    expect(out.report.skipped.some((s) => s.path === "b" && /weird/.test(s.reason))).toBe(true);
  });

  it("a file node with no file string is left as is", () => {
    const out = importVault(
      [
        entry(
          "c.canvas",
          canvasBytes([{ id: "a", type: "file", x: 0, y: 0, width: 1, height: 1 }]),
        ),
      ],
      { mode: "new" },
    );
    expect(out.canvases[0]!.nodeCount).toBe(1);
  });

  it("a canvas referencing itself or another canvas is reported, not recursed", () => {
    const out = importVault(
      [
        entry("a.canvas", canvasBytes([fileNode("x", "a.canvas"), fileNode("y", "b.canvas")])),
        entry("b.canvas", canvasBytes([fileNode("z", "a.canvas")])),
      ],
      { mode: "new" },
    );
    expect(out.canvases).toHaveLength(2);
    expect(out.report.skipped.filter((s) => /canvas inside a canvas/.test(s.reason))).toHaveLength(
      3,
    );
  });

  it("an empty import yields nothing and no error", () => {
    const out = importVault([], { mode: "new" });
    expect(out.canvases).toEqual([]);
    expect(out.report.skipped).toEqual([]);
  });
});

describe("hostile zips", () => {
  it("never lets a path escape the vault", () => {
    for (const bad of ["../x.md", "a/../../x.md", "a//b.md", "a/./../b.md", "..\\x.md"]) {
      expect(cleanZipPath(bad), bad).toBeNull();
    }
    expect(cleanZipPath("C:/x.md")).toBe("C:/x.md");
  });

  it("drops traversal names when unzipping, keeping the rest", () => {
    const zip = zipSync({ "ok.md": enc("ok"), "../evil.md": enc("x"), "dir/": new Uint8Array() });
    const { entries } = unzipVault(zip);
    expect(entries.map((e) => e.path)).toEqual(["ok.md"]);
  });

  it("refuses a zip that isn't one", () => {
    expect(() => unzipVault(enc("not a zip at all, just text"))).toThrow();
  });

  it("an entry whose directory under-declares its size never yields more bytes than declared", () => {
    const zip = zipSync({ "a.md": enc("x".repeat(1_000)) }, { level: 6 });
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let i = 0; i < zip.length - 4; i++) {
      if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, 10, true);
    }
    let result: ReturnType<typeof unzipVault> | null = null;
    try {
      result = unzipVault(zip);
    } catch {
      // Refusing is fine too.
    }
    if (result) expect(result.entries[0]!.bytes.length).toBeLessThanOrEqual(1_000);
  });

  it("an empty zip and a junk-only zip import nothing", () => {
    expect(unzipVault(zipSync({})).entries).toEqual([]);
    const junk = unzipVault(zipSync({ ".obsidian/app.json": enc("{}"), "__MACOSX/x": enc("y") }));
    expect(junk.entries).toEqual([]);
    expect(junk.ignored).toBe(2);
  });

  it("zipVault → unzipVault keeps CJK, NFD and space names exactly", () => {
    const names = ["日本語/メモ.md", "Résumé.md".normalize("NFD"), "a b/c d.md"];
    const { entries } = unzipVault(zipVault(names.map((path) => ({ path, bytes: enc(path) }))));
    expect(entries.map((e) => e.path).sort()).toEqual([...names].sort());
  });
});

describe("path resolution", () => {
  const resolver = new VaultResolver([
    entry("Vault/Notes/Idea.md", "1"),
    entry("Vault/Other/Idea.md", "2"),
    entry("Vault/Notes/Unique.md", "3"),
    entry("Vault/Notes/Café.md".normalize("NFD"), "4"),
    entry("Vault/CASE/Mixed.md", "5"),
  ]);
  it.each([
    ["exact with root", "Vault/Notes/Idea.md", "found", "exact"],
    ["root stripped", "Notes/Idea.md", "found", "root-stripped"],
    ["case", "case/mixed.md", "found", "case"],
    ["NFC asks for NFD", "Notes/Café.md".normalize("NFC"), "found", "exact"],
    ["unique basename", "Unique.md", "found", "basename"],
    ["ambiguous basename", "Idea.md", "ambiguous", undefined],
    ["missing", "Nope.md", "missing", undefined],
    ["subpath is not part of the path", "Notes/Idea.md#Heading", "missing", undefined],
  ])("%s", (_label, file, kind, how) => {
    const r = resolver.resolve(file);
    expect(r.kind).toBe(kind);
    if (r.kind === "found") {
      // NFD asked for NFC resolves through the NFC map: count either exact or root-stripped.
      if (how === "exact") expect(["exact", "root-stripped"]).toContain(r.how);
      else expect(r.how).toBe(how);
    }
  });

  it("does not strip a root that only some entries share", () => {
    const r = new VaultResolver([entry("A/x.md", ""), entry("y.md", "")]);
    expect(r.root).toBe("");
  });
});

describe("uploads", () => {
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

describe("export edge cases", () => {
  it("a note path that could escape the vault is left out and reported", () => {
    const doc = new Y.Doc();
    const nodes = canvasNodes(doc);
    for (const [id, file] of [
      ["a", "../escape.md"],
      ["b", "/abs.md"],
      ["c", "ok/fine.md"],
    ] as const) {
      const n = new Y.Map<unknown>();
      n.set("type", "file");
      n.set("file", file);
      n.set("text", new Y.Text("body"));
      n.set("x", 0);
      n.set("y", 0);
      n.set("w", 1);
      n.set("h", 1);
      nodes.set(id, n);
    }
    const out = buildVaultExport(doc, { canvasPath: "c.canvas", attachments: {} });
    expect(out.files.map((f) => f.path).sort()).toEqual(["c.canvas", "ok/fine.md"]);
    expect(out.leftOut.map((l) => l.path).sort()).toEqual(["../escape.md", "/abs.md"]);
  });

  it("two cards with different text for the same note: the first is written, the clash reported", () => {
    const doc = new Y.Doc();
    const nodes = canvasNodes(doc);
    for (const [id, text] of [
      ["a", "one"],
      ["b", "two"],
    ] as const) {
      const n = new Y.Map<unknown>();
      n.set("type", "file");
      n.set("file", "n.md");
      n.set("text", new Y.Text(text));
      n.set("z", id);
      nodes.set(id, n);
    }
    const out = buildVaultExport(doc, { canvasPath: "c.canvas", attachments: {} });
    expect(out.files.filter((f) => f.path === "n.md")).toHaveLength(1);
    expect(out.leftOut).toHaveLength(1);
  });

  it("a note whose path is the canvas's own path is not written over the canvas", () => {
    const doc = new Y.Doc();
    const n = new Y.Map<unknown>();
    n.set("type", "file");
    n.set("file", "Plan.canvas");
    n.set("text", new Y.Text("not json"));
    canvasNodes(doc).set("a", n);
    const out = buildVaultExport(doc, { canvasPath: "Plan.canvas", attachments: {} });
    expect(out.files.filter((f) => f.path === "Plan.canvas")).toHaveLength(1);
    expect(new TextDecoder().decode(out.files[0]!.bytes!)).toMatch(/^\{/);
  });

  it("an image that can't be downloaded is left out of the zip and reported", async () => {
    const fetchMock = vi.fn(async () => new Response("no", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { zip, leftOut } = await runExportJob({
        files: [
          { path: "c.canvas", bytes: enc("{}") },
          { path: "a.png", url: "/images/a" },
        ],
      });
      expect(unzipVault(zip).entries.map((e) => e.path)).toEqual(["c.canvas"]);
      expect(leftOut).toEqual([{ path: "a.png", reason: "The image couldn't be downloaded." }]);
      expect(fetchMock).toHaveBeenCalledWith("/images/a", { credentials: "same-origin" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

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

describe("the worker protocol", () => {
  it("carries a refusal's limit and numbers across the boundary", () => {
    const original = refusal("maxNodes", 2_001, 2_000);
    const back = deserializeIoError(structuredClone(serializeIoError(original)));
    expect(back).toBeInstanceOf(ImportRefusedError);
    expect(back).toMatchObject({
      limit: "maxNodes",
      actual: 2_001,
      max: 2_000,
      message: original.message,
    });
  });

  it("carries any other error's message", () => {
    const back = deserializeIoError(structuredClone(serializeIoError(new TypeError("boom"))));
    expect(back.message).toBe("boom");
    expect(back.name).toBe("TypeError");
    expect(deserializeIoError(serializeIoError("plain")).message).toBe("plain");
  });

  it("transfers whole buffers only, never a view into a shared one", () => {
    const whole = new Uint8Array(8);
    const shared = new Uint8Array(new ArrayBuffer(16), 4, 4);
    const out = transferablesOf({ a: whole, b: [shared], c: { d: whole } });
    expect(out).toEqual([whole.buffer]);
  });

  it("an import result survives structuredClone (what postMessage does)", async () => {
    const result = await runImportJob({
      source: {
        files: [
          { path: "c.canvas", file: new Blob([canvasBytes([fileNode("a", "a.png")])]) },
          { path: "a.png", file: new Blob([PNG]) },
        ],
      },
      options: { mode: "new" },
    });
    const cloned = structuredClone(result);
    expect(cloned).toEqual(result);
  });
});
