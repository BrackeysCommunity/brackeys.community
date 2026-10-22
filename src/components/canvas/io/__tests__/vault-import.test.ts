import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { canvasNodes, docToJsonCanvas, type JsonCanvas } from "@/lib/canvas/json-canvas";

import * as seam from "../markdown-seam";
import { serializeCanvas } from "../vault-export";
import { canvasState, commonRoot, importVault, scanVault, VaultResolver } from "../vault-import";
import { zipVault } from "../vault-zip";
import { importFiles, syntheticVault } from "./import-harness";
import { enc, entry, fixture, fixtureNames, memoryScope, normalized, PNG } from "./vault-fixtures";

vi.mock("@/orpc/client", () => ({ client: {} }));

function load(state: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
}

const canvasFile = (canvas: JsonCanvas) => serializeCanvas(canvas);
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
    ["a subpath is not part of the path", "Notes/Idea.md#Heading", "missing", null],
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
    expect(new VaultResolver([entry("A/x.md", ""), entry("y.md", "")]).root).toBe("");
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

describe("importVault: malformed canvases", () => {
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

describe("the Markdown seam", () => {
  it("is asked about every .md, referenced or lone, and decides what each becomes", async () => {
    const referenced = vi.spyOn(seam, "placeReferencedNote");
    const lone = vi.spyOn(seam, "placeLoneNote");
    const isMd = vi.spyOn(seam, "isMarkdownPath");
    const scope = memoryScope();
    await importFiles(scope, zipVault(syntheticVault()));
    // Six file nodes name a resolvable note (Idea.md twice).
    expect(referenced).toHaveBeenCalledTimes(6);
    const mdPaths = syntheticVault()
      .filter((e) => e.path.toLowerCase().endsWith(".md"))
      .map((e) => e.path);
    for (const path of mdPaths) {
      if (path.includes("/.trash/")) continue;
      const asked = isMd.mock.calls.some(([p]) => p === path || p === path.slice("Vault/".length));
      expect(asked, path).toBe(true);
    }
    referenced.mockRestore();
    lone.mockRestore();
    isMd.mockRestore();
  });

  it("is the only io module that tests for the .md extension", async () => {
    const dir = join(import.meta.dirname, "..");
    const routesMarkdown =
      /endsWith\(\s*["'`]\.md|\\\.md\b|===\s*["'`]note["'`]|["'`]note["'`]\s*===/;
    const offenders = readdirSync(dir)
      .filter((f) => /\.(ts|tsx)$/.test(f) && f !== "markdown-seam.ts")
      .filter((f) => routesMarkdown.test(readFileSync(join(dir, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
