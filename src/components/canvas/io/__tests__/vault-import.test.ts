import { describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { canvasNodes, docToJsonCanvas, type JsonCanvas } from "@/lib/canvas/json-canvas";
import { CANVAS_IMPORT_LIMITS, CANVAS_LIMITS } from "@/lib/canvas/limits";

import * as seam from "../markdown-seam";
import { serializeCanvas } from "../vault-export";
import {
  canvasState,
  commonRoot,
  ImportRefusedError,
  importVault,
  scanVault,
  VaultResolver,
} from "../vault-import";
import { entry, fixture, fixtureNames, normalized, PNG } from "./vault-fixtures";

function load(state: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
}

const canvasFile = (canvas: JsonCanvas) => serializeCanvas(canvas);

describe("importVault: fixtures", () => {
  it.each(fixtureNames)("%s: .canvas → new canvas → JSON is lossless", (name) => {
    const source = fixture(name);
    const result = importVault([entry(name, JSON.stringify(source))], { mode: "new" });
    expect(result.canvases).toHaveLength(1);
    const [imported] = result.canvases;
    const doc = load(canvasState(imported!.canvas, imported!.docFields));
    expect(docToJsonCanvas(doc)).toEqual(normalized(source));
    // The scratch state the limits are checked on is the same canvas.
    expect(docToJsonCanvas(load(imported!.state))).toEqual(normalized(source));
  });

  it("names the new canvas after its path, repaired against the scope", () => {
    const file = canvasFile({ nodes: [], edges: [] });
    const result = importVault([entry("Vault/Boards/Plan.canvas", file)], {
      mode: "new",
      folder: "Imported",
      takenCanvasKeys: ["imported/boards/plan.canvas"],
    });
    expect(result.canvases[0]!.sourcePath).toBe("Boards/Plan.canvas");
    expect(result.canvases[0]!.targetPath).toBe("Imported/Boards/Plan 2.canvas");
    expect(result.report.repairs).toEqual([
      expect.objectContaining({
        from: "Imported/Boards/Plan.canvas",
        to: "Imported/Boards/Plan 2.canvas",
      }),
    ]);
  });

  it("reports an unreadable canvas instead of throwing", () => {
    const result = importVault([entry("Broken.canvas", "{nope")], { mode: "new" });
    expect(result.canvases).toEqual([]);
    expect(result.report.skipped).toEqual([
      expect.objectContaining({
        path: "Broken.canvas",
        reason: expect.stringContaining("JSON Canvas"),
      }),
    ]);
  });
});

describe("path resolution", () => {
  const entries = [
    entry("Vault/Notes/Idea.md", "idea"),
    entry("Vault/Notes/Café.md".normalize("NFD"), "nfd"),
    entry("Vault/Deep/Only Here.md", "deep"),
    entry("Vault/A/dup.md", "a"),
    entry("Vault/B/dup.md", "b"),
    entry("Vault/Mixed/Case.md", "case"),
  ];
  const resolver = new VaultResolver(entries);

  it.each([
    ["exact", "Vault/Notes/Idea.md", "found", "Notes/Idea.md"],
    ["common root stripped", "Notes/Idea.md", "found", "Notes/Idea.md"],
    [
      "NFC asks for an NFD file",
      "Notes/Café.md".normalize("NFC"),
      "found",
      "Notes/Café.md".normalize("NFC"),
    ],
    ["case", "mixed/case.md", "found", "Mixed/Case.md"],
    ["unique basename", "Elsewhere/Only Here.md", "found", "Deep/Only Here.md"],
    ["ambiguous basename", "Gone/dup.md", "ambiguous", null],
    ["missing", "Nowhere.md", "missing", null],
  ])("%s", (_label, file, kind, vaultPath) => {
    const resolved = resolver.resolve(file);
    expect(resolved.kind).toBe(kind);
    if (resolved.kind === "found") expect(resolved.vaultPath).toBe(vaultPath);
    if (resolved.kind === "ambiguous")
      expect(resolved.candidates).toEqual(["A/dup.md", "B/dup.md"]);
  });

  it("strips a root only when every entry shares it", () => {
    expect(commonRoot(["V/a.md", "V/b/c.md"])).toBe("V");
    expect(commonRoot(["V/a.md", "W/b.md"])).toBe("");
    expect(commonRoot(["a.md"])).toBe("");
  });
});

describe("importVault: what file nodes become", () => {
  const plan = {
    nodes: [
      { id: "n1", type: "file", file: "Notes/Idea.md", x: 0, y: 0, width: 100, height: 100 },
      {
        id: "n2",
        type: "file",
        file: "Notes/Idea.md",
        subpath: "#Part",
        x: 0,
        y: 200,
        width: 100,
        height: 100,
      },
      { id: "n3", type: "file", file: "attachments/a.png", x: 200, y: 0, width: 100, height: 100 },
      { id: "n4", type: "file", file: "Docs/spec.pdf", x: 400, y: 0, width: 100, height: 100 },
      { id: "n5", type: "file", file: "Views/x.base", x: 600, y: 0, width: 100, height: 100 },
      { id: "n6", type: "file", file: "Gone/dup.md", x: 800, y: 0, width: 100, height: 100 },
      { id: "n7", type: "file", file: "Missing.md", x: 1000, y: 0, width: 100, height: 100 },
      { id: "n8", type: "file", file: "Other.canvas", x: 1200, y: 0, width: 100, height: 100 },
    ],
    edges: [],
  };
  const entries = [
    entry("Vault/Plan.canvas", JSON.stringify(plan)),
    entry("Vault/Other.canvas", JSON.stringify({ nodes: [], edges: [] })),
    entry("Vault/Notes/Idea.md", "﻿# Idea\r\nline  \r\n![[embedded.png]]\n"),
    entry("Vault/attachments/a.png", PNG),
    entry("Vault/Docs/spec.pdf", "%PDF"),
    entry("Vault/Views/x.base", "views:"),
    entry("Vault/A/dup.md", "a"),
    entry("Vault/B/dup.md", "b"),
    entry("Vault/Unused.md", "nobody points here"),
  ];

  it("attaches notes, queues images and reports everything left out", () => {
    const result = importVault(entries, { mode: "new", selected: ["Plan.canvas"] });
    const [plan] = result.canvases;
    expect(plan!.docFields.n1).toEqual({
      text: "# Idea\r\nline  \r\n![[embedded.png]]\n",
      bom: true,
    });
    expect(plan!.docFields.n2).toEqual(plan!.docFields.n1);
    expect(result.report.notesAttached).toBe(2);
    expect(result.images).toEqual([
      expect.objectContaining({ path: "attachments/a.png", refs: [{ canvas: 0, nodeId: "n3" }] }),
    ]);

    const reasons = Object.fromEntries(result.report.skipped.map((s) => [s.path, s.reason]));
    expect(reasons["Docs/spec.pdf"]).toMatch(/PDF/);
    expect(reasons["Views/x.base"]).toMatch(/Bases/);
    expect(reasons["Gone/dup.md"]).toMatch(/2 files match/);
    expect(reasons["Missing.md"]).toMatch(/Not in the import/);
    expect(reasons["Other.canvas"]).toMatch(/canvas inside a canvas/);
    expect(reasons["Unused.md"]).toMatch(/Not on any imported canvas/);
    expect(reasons["embedded.png"]).toMatch(/Embedded in a note/);
  });

  it("keeps note bodies out of JSON Canvas output and the snapshot", () => {
    const result = importVault(entries, { mode: "new", selected: ["Plan.canvas"] });
    const doc = load(result.canvases[0]!.state);
    expect(JSON.stringify(docToJsonCanvas(doc))).not.toContain("Idea\\r\\n");
    expect(canvasNodes(doc).get("n1")?.get("bom")).toBe(true);
  });

  it("asks the Markdown seam about every note, and only it", () => {
    const referenced = vi.spyOn(seam, "placeReferencedNote");
    const asked = vi.spyOn(seam, "isMarkdownPath");
    importVault(entries, { mode: "new", selected: ["Plan.canvas"] });
    expect(referenced).toHaveBeenCalledTimes(2);
    const mdPaths = new Set(asked.mock.calls.map(([p]) => p).filter((p) => p.endsWith(".md")));
    expect(mdPaths.size).toBeGreaterThan(0);
    referenced.mockRestore();
    asked.mockRestore();
  });

  it("puts loose notes and images on one canvas when there's none", () => {
    const result = importVault(
      [entry("Drop/a.md", "# A"), entry("Drop/b.png", PNG), entry("Drop/c.pdf", "%PDF")],
      { mode: "new" },
    );
    expect(result.canvases).toHaveLength(1);
    expect(result.canvases[0]!.targetPath).toBe("Drop.canvas");
    expect(result.canvases[0]!.canvas.nodes.map((n) => n.type)).toEqual(["text", "file"]);
    expect(result.report.textCards).toBe(1);
    expect(result.images).toHaveLength(1);
    expect(result.report.skipped).toEqual([
      { path: "c.pdf", reason: "PDF files aren't supported on canvases yet." },
    ]);
  });

  it("lists what a scan finds", () => {
    const scan = scanVault(entries);
    expect(scan.root).toBe("Vault");
    expect(scan.canvases.map((c) => c.sourcePath)).toEqual(["Other.canvas", "Plan.canvas"]);
    expect([scan.notes, scan.images, scan.other]).toEqual([4, 1, 2]);
  });
});

describe("importVault: refused up front, with the numbers", () => {
  const big = (n: number) => ({
    nodes: Array.from({ length: n }, (_, i) => ({
      id: `n${i}`,
      type: "text",
      text: "",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    })),
    edges: [],
  });

  function refused(run: () => unknown): ImportRefusedError {
    try {
      run();
    } catch (error) {
      expect(error).toBeInstanceOf(ImportRefusedError);
      return error as ImportRefusedError;
    }
    throw new Error("not refused");
  }

  it("too many cards on a new canvas", () => {
    const error = refused(() =>
      importVault([entry("Big.canvas", JSON.stringify(big(CANVAS_LIMITS.maxNodes + 1)))], {
        mode: "new",
      }),
    );
    expect([error.limit, error.actual, error.max]).toEqual(["maxNodes", 2001, 2000]);
    expect(error.message).toContain("2,001");
  });

  it("too many cards counted with what's already on the open canvas", () => {
    const error = refused(() =>
      importVault([entry("Small.canvas", JSON.stringify(big(10)))], {
        mode: "into",
        existing: { nodes: CANVAS_LIMITS.maxNodes - 5, stateBytes: 0 },
      }),
    );
    expect([error.limit, error.actual]).toEqual(["maxNodes", CANVAS_LIMITS.maxNodes + 5]);
  });

  it("too much state", () => {
    const text = "x".repeat(CANVAS_LIMITS.maxCardText);
    const heavy = {
      nodes: Array.from({ length: 300 }, (_, i) => ({
        id: `n${i}`,
        type: "text",
        text,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      })),
      edges: [],
    };
    const error = refused(() =>
      importVault([entry("Heavy.canvas", JSON.stringify(heavy))], { mode: "new" }),
    );
    expect(error.limit).toBe("maxStateBytes");
    expect(error.actual).toBeGreaterThan(CANVAS_LIMITS.maxStateBytes);
  });

  it("too many files", () => {
    const entries = Array.from({ length: CANVAS_IMPORT_LIMITS.maxFiles + 1 }, (_, i) =>
      entry(`n${i}.md`, ""),
    );
    expect(refused(() => importVault(entries, { mode: "new" })).limit).toBe("maxFiles");
  });

  it("too many images", () => {
    const n = CANVAS_IMPORT_LIMITS.maxImagesPerImport + 1;
    const canvas = {
      nodes: Array.from({ length: n }, (_, i) => ({
        id: `n${i}`,
        type: "file",
        file: `i${i}.png`,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      })),
      edges: [],
    };
    const entries = [
      entry("C.canvas", JSON.stringify(canvas)),
      ...Array.from({ length: n }, (_, i) => entry(`i${i}.png`, PNG)),
    ];
    const error = refused(() => importVault(entries, { mode: "new" }));
    expect([error.limit, error.actual, error.max]).toEqual([
      "maxImagesPerImport",
      n,
      CANVAS_IMPORT_LIMITS.maxImagesPerImport,
    ]);
  });
});
