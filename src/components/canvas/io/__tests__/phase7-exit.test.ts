/**
 * Phase 7's exit criteria, checked end to end through the same functions the
 * editor and the import dialog call: the worker's jobs (run in-page), the
 * image matching and uploads (against an in-memory scope), the vault export
 * and the zip. Independent of the builder's per-module tests.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { zipSync } from "fflate";
import { describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import {
  applyJsonCanvas,
  canvasNodes,
  deriveSnapshot,
  docToJsonCanvas,
  fileBodyOf,
  type JsonCanvas,
} from "@/lib/canvas/json-canvas";
import { CANVAS_IMPORT_LIMITS, CANVAS_LIMITS } from "@/lib/canvas/limits";
import { pathKey } from "@/lib/canvas/paths";

import { runImportJob } from "../canvas-io-jobs";
import { finalizeCanvases, resolveImages } from "../import-flow";
import * as seam from "../markdown-seam";
import { buildVaultExport, canvasMarkdown, serializeCanvas } from "../vault-export";
import { ImportRefusedError, type VaultEntry, type VaultImportOptions } from "../vault-import";
import { unzipVault, zipVault } from "../vault-zip";
import {
  enc,
  entry,
  FIXTURES,
  fixtureNames,
  GIF,
  LEGACY_FIXTURE,
  memoryScope,
  PNG,
  WEBP,
} from "./vault-fixtures";

vi.mock("@/orpc/client", () => ({ client: {} }));

type Scope = ReturnType<typeof memoryScope>;

const ALL_FIXTURES = [...fixtureNames, LEGACY_FIXTURE].sort();
const raw = (name: string) => readFileSync(join(FIXTURES, name));

/** The fixture as `docToJsonCanvas` writes it: missing nodes/edges arrays filled, the legacy key renamed. */
function expectedJson(name: string): JsonCanvas {
  const parsed = JSON.parse(raw(name).toString("utf8")) as JsonCanvas & Record<string, unknown>;
  const rename = (o: Record<string, unknown>) => {
    if (!("brackeys" in o)) return o;
    const { brackeys, ...rest } = o;
    return { ...rest, jamsTeam: brackeys };
  };
  const { jamsTeam: _top, brackeys: _legacyTop, ...top } = parsed;
  return {
    ...top,
    nodes: (parsed.nodes ?? []).map((n) => rename(n as Record<string, unknown>)),
    edges: parsed.edges ?? [],
  } as JsonCanvas;
}

/** A whole import, as the dialog runs it: the job, then images, then the final states. */
async function importFiles(
  scope: Scope,
  files: { path: string; bytes: Uint8Array }[] | Uint8Array,
  options: VaultImportOptions = { mode: "new" },
) {
  const source =
    files instanceof Uint8Array
      ? { zip: new Blob([files as Uint8Array<ArrayBuffer>]) }
      : {
          files: files.map((f) => ({
            path: f.path,
            file: new Blob([f.bytes as Uint8Array<ArrayBuffer>]),
          })),
        };
  const result = await runImportJob({ source, options });
  if (result.kind !== "import") throw new Error("expected an import");
  const images = await resolveImages(result.canvases, result.images, scope.uploader);
  const finals = finalizeCanvases(result.canvases, result.images, images.resolved);
  return { result, images, finals };
}

const docOf = (state: Uint8Array) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
};

/** The canvas menu's "Export .canvas": the doc's JSON Canvas, tab-indented. */
const exportCanvas = (state: Uint8Array) => serializeCanvas(docToJsonCanvas(docOf(state)));

function exportVault(scope: Scope, finals: { targetPath: string; state: Uint8Array }[]) {
  const files = new Map<string, Uint8Array>();
  const leftOut: { path: string; reason: string }[] = [];
  for (const final of finals) {
    const built = buildVaultExport(docOf(final.state), {
      canvasPath: final.targetPath,
      attachments: scope.attachments(),
    });
    leftOut.push(...built.leftOut);
    for (const file of built.files) files.set(file.path, file.bytes ?? scope.bytesAt(file.url!)!);
  }
  return { files, leftOut };
}

// ── 1. Every fixture: .canvas export → import as a new canvas → export ─────

describe("exit 1: every fixture survives .canvas export → import → export", () => {
  it("covers all fifteen fixtures, the legacy-key one included", () => {
    expect(ALL_FIXTURES).toHaveLength(15);
  });

  it.each(ALL_FIXTURES)("%s", async (name) => {
    const scope = memoryScope();
    // The fixture file itself, imported as a new canvas.
    const first = await importFiles(scope, [{ path: name, bytes: raw(name) }]);
    expect(first.finals).toHaveLength(1);
    const exported1 = exportCanvas(first.finals[0]!.state);
    expect(JSON.parse(exported1)).toEqual(expectedJson(name));

    // Its export, imported again as a new canvas, exports the same JSON.
    const second = await importFiles(scope, [{ path: name, bytes: enc(exported1) }]);
    const exported2 = exportCanvas(second.finals[0]!.state);
    expect(JSON.parse(exported2)).toEqual(JSON.parse(exported1));
    // Our own serialiser is a fixed point: byte for byte the second time.
    expect(exported2).toBe(exported1);
    expect(scope.uploads).toEqual([]);
  });

  it("keeps fromSide/toSide/fromEnd/toEnd present or absent exactly as in the source", async () => {
    const source = {
      nodes: [
        { id: "a", type: "text", text: "a", x: 0, y: 0, width: 10, height: 10 },
        { id: "b", type: "text", text: "b", x: 50, y: 0, width: 10, height: 10 },
      ],
      edges: [
        { id: "e0", fromNode: "a", toNode: "b" },
        { id: "e1", fromNode: "a", fromSide: "right", toNode: "b" },
        { id: "e2", fromNode: "a", toNode: "b", toEnd: "none" },
        { id: "e3", fromNode: "a", fromEnd: "arrow", toNode: "b", toSide: "top" },
        {
          id: "e4",
          fromNode: "a",
          fromSide: "left",
          fromEnd: "none",
          toNode: "b",
          toSide: "bottom",
          toEnd: "arrow",
          label: "all",
          color: "#ff00aa",
        },
      ],
    };
    const scope = memoryScope();
    const { finals } = await importFiles(scope, [
      { path: "e.canvas", bytes: enc(JSON.stringify(source)) },
    ]);
    const out = JSON.parse(exportCanvas(finals[0]!.state)) as JsonCanvas;
    expect(out.edges).toEqual(source.edges);
  });
});

// ── 2. The synthetic vault: import, then export for Obsidian, byte for byte ─

const NFD_NOTE = "Notes/Résumé café.md".normalize("NFD");
const NFD_IMAGE = "Art/naïve.png".normalize("NFD");

/** Obsidian's own layout: tab-indented, one node per line, Obsidian's key order. */
function obsidianLayout(canvas: { nodes: object[]; edges: object[] }): string {
  const lines = (items: object[]) => items.map((i) => `\t\t${JSON.stringify(i)}`).join(",\n");
  return `{\n\t"nodes":[\n${lines(canvas.nodes)}\n\t],\n\t"edges":[\n${lines(canvas.edges)}\n\t]\n}`;
}

const board = {
  nodes: [
    {
      id: "n01",
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      type: "file",
      file: "Notes/Deep/Nest/Idea.md",
    },
    {
      id: "n02",
      x: 0,
      y: 300,
      width: 300,
      height: 200,
      type: "file",
      file: "Notes/Deep/Nest/Idea.md",
      subpath: "#Second heading",
    },
    { id: "n03", x: 400, y: 0, width: 300, height: 200, type: "file", file: "日本語/メモ.md" },
    { id: "n04", x: 800, y: 0, width: 300, height: 200, type: "file", file: NFD_NOTE },
    { id: "n05", x: 1200, y: 0, width: 300, height: 200, type: "file", file: "Notes/BOM.md" },
    { id: "n06", x: 1600, y: 0, width: 300, height: 200, type: "file", file: "Notes/CRLF.md" },
    { id: "n07", x: 0, y: 600, width: 100, height: 100, type: "file", file: "Art/pixel.png" },
    { id: "n08", x: 200, y: 600, width: 100, height: 100, type: "file", file: "Art/anim.gif" },
    { id: "n09", x: 400, y: 600, width: 100, height: 100, type: "file", file: "Art/tiny.webp" },
    { id: "n10", x: 600, y: 600, width: 100, height: 100, type: "file", file: NFD_IMAGE },
    { id: "n11", x: 800, y: 600, width: 100, height: 100, type: "file", file: "Docs/spec.pdf" },
    { id: "n12", x: 1000, y: 600, width: 100, height: 100, type: "file", file: "Views/tasks.base" },
    { id: "n13", x: 1200, y: 600, width: 100, height: 100, type: "file", file: "dup.md" },
    { id: "n14", x: 1400, y: 600, width: 100, height: 100, type: "file", file: "Gone/missing.md" },
    {
      id: "n15",
      x: 0,
      y: 900,
      width: 200,
      height: 100,
      type: "text",
      text: "Plain card",
      color: "4",
    },
  ],
  edges: [
    { id: "e1", fromNode: "n01", fromSide: "right", toNode: "n03", toSide: "left" },
    { id: "e2", fromNode: "n03", toNode: "n05", label: "next" },
  ],
};

const NOTES: Record<string, Uint8Array> = {
  "Notes/Deep/Nest/Idea.md": enc("# Idea\n\n## Second heading\n\ntext with trailing   \n\t\n"),
  "日本語/メモ.md": enc("# メモ\n日本語のテキスト\n![[Art/embedded-only.png]]\n"),
  [NFD_NOTE]: enc("Résumé, decomposed\n"),
  "Notes/BOM.md": new Uint8Array([0xef, 0xbb, 0xbf, ...enc("starts with a BOM\r\n")]),
  "Notes/CRLF.md": enc("line one\r\nline two  \r\n\r\nno newline at end"),
};

function syntheticVault(canvasBytes: (name: string) => Uint8Array = raw): VaultEntry[] {
  const fixtureCanvases = [
    "obsidiantools-crazywall.canvas",
    "jsoncanvas-sample.canvas",
    "jcv-demo.canvas",
  ];
  return [
    entry("Vault/Boards/Board.canvas", obsidianLayout(board)),
    ...fixtureCanvases.map((name) => entry(`Vault/Fixtures/${name}`, canvasBytes(name))),
    ...Object.entries(NOTES).map(([path, bytes]) => entry(`Vault/${path}`, bytes)),
    entry("Vault/Art/pixel.png", PNG),
    entry("Vault/Art/anim.gif", GIF),
    entry("Vault/Art/tiny.webp", WEBP),
    entry(`Vault/${NFD_IMAGE}`, new Uint8Array([...PNG, 0])),
    entry("Vault/Art/embedded-only.png", PNG),
    entry("Vault/Docs/spec.pdf", "%PDF-1.4\n"),
    entry("Vault/Views/tasks.base", "views: []\n"),
    entry("Vault/A/dup.md", "first"),
    entry("Vault/B/dup.md", "second"),
    entry("Vault/Loose.md", "Not on any canvas"),
    entry("Vault/.obsidian/workspace.json", "{}"),
    entry("Vault/.trash/old.md", "old"),
    entry("__MACOSX/Vault/._Board.canvas", "junk"),
    entry("Vault/.DS_Store", "junk"),
  ];
}

describe("exit 2: a synthetic vault zip imports and exports for Obsidian byte for byte", () => {
  async function roundTrip(canvasBytes?: (name: string) => Uint8Array) {
    const source = syntheticVault(canvasBytes);
    const scope = memoryScope();
    const imported = await importFiles(scope, zipVault(source));
    const exported = exportVault(scope, imported.finals);
    return { source, scope, ...imported, exported };
  }

  it("reports every skipped item with a reason", async () => {
    const { result, images, finals } = await roundTrip();
    expect(finals.map((f) => f.targetPath).sort()).toEqual([
      "Boards/Board.canvas",
      "Fixtures/jcv-demo.canvas",
      "Fixtures/jsoncanvas-sample.canvas",
      "Fixtures/obsidiantools-crazywall.canvas",
    ]);
    expect(images.uploaded).toBe(4);
    const reasons = new Map(result.report.skipped.map((s) => [s.path, s.reason]));
    for (const path of [
      "Docs/spec.pdf",
      "Views/tasks.base",
      "dup.md",
      "Gone/missing.md",
      "Loose.md",
      "Art/embedded-only.png",
    ]) {
      expect(reasons.get(path), path).toMatch(/\w/);
    }
    expect(reasons.get("Docs/spec.pdf")).toMatch(/PDF/);
    expect(reasons.get("Views/tasks.base")).toMatch(/Bases/);
    expect(reasons.get("dup.md")).toMatch(/2 files match.*A\/dup\.md.*B\/dup\.md/);
    expect(reasons.get("Gone/missing.md")).toMatch(/Not in the import/);
    for (const line of result.report.skipped)
      expect(line.reason.length, line.path).toBeGreaterThan(5);
    expect(result.report.notesAttached).toBe(6);
  });

  it("writes every imported note and image back at its path, byte for byte", async () => {
    const { source, exported, result, images } = await roundTrip();
    const byKey = new Map([...exported.files].map(([p, b]) => [pathKey(p), { p, b }]));
    const repaired = new Set(
      [...result.report.repairs, ...images.repairs].map((r) => pathKey(r.from)),
    );
    const notesAndImages = source.filter((e) => /^Vault\/(Notes|日本語|Art)\//.test(e.path));
    const missing: string[] = [];
    for (const file of notesAndImages) {
      const inVault = file.path.slice("Vault/".length);
      if (inVault === "Art/embedded-only.png") continue; // reported: embeds aren't uploaded
      const out = byKey.get(pathKey(inVault));
      if (!out) {
        if (!repaired.has(pathKey(inVault))) missing.push(inVault);
        continue;
      }
      expect(Buffer.from(out.b).equals(Buffer.from(file.bytes)), inVault).toBe(true);
    }
    expect(missing, "imported but neither exported nor listed as a repair").toEqual([]);
  });

  it("writes canvases our serialiser produced back byte for byte", async () => {
    const canonical = (name: string) => {
      const doc = new Y.Doc();
      applyJsonCanvas(doc, JSON.parse(raw(name).toString("utf8")), { mode: "whole" });
      return enc(serializeCanvas(docToJsonCanvas(doc)));
    };
    const { source, exported } = await roundTrip(canonical);
    for (const file of source.filter((e) => e.path.startsWith("Vault/Fixtures/"))) {
      const out = exported.files.get(file.path.slice("Vault/".length))!;
      expect(Buffer.from(out).equals(Buffer.from(file.bytes)), file.path).toBe(true);
    }
  });

  // jcv-demo was re-serialised by a plugin (pretty-printed, edges first);
  // every other canvas in the vault is in Obsidian's own layout. The one
  // expected change is the NFD image path, which is stored, and so
  // written, in NFC (as in the deep-equal test below).
  it("writes canvases Obsidian wrote back byte for byte", async () => {
    const { source, exported } = await roundTrip();
    const written = source.filter(
      (e) => /^Vault\/.*\.canvas$/.test(e.path) && !e.path.endsWith("jcv-demo.canvas"),
    );
    expect(written).toHaveLength(3);
    for (const file of written) {
      const expected = Buffer.from(file.bytes)
        .toString("utf8")
        .replaceAll(JSON.stringify(NFD_IMAGE), JSON.stringify(NFD_IMAGE.normalize("NFC")));
      const out = exported.files.get(file.path.slice("Vault/".length))!;
      expect(Buffer.from(out).toString("utf8"), file.path).toBe(expected);
    }
  });

  it("writes every Obsidian-written fixture back byte for byte from a .canvas import", async () => {
    const obsidianWritten = ALL_FIXTURES.filter(
      (name) => !name.startsWith("synthetic-") && name !== "jcv-demo.canvas",
    );
    expect(obsidianWritten).toHaveLength(11);
    for (const name of obsidianWritten) {
      const { finals } = await importFiles(memoryScope(), [{ path: name, bytes: raw(name) }]);
      expect(exportCanvas(finals[0]!.state), name).toBe(raw(name).toString("utf8"));
    }
  });

  it("writes canvases Obsidian wrote back as deep-equal JSON (file nodes for images kept plain)", async () => {
    const { source, exported } = await roundTrip();
    for (const file of source.filter((e) => /^Vault\/.*\.canvas$/.test(e.path))) {
      const out = exported.files.get(file.path.slice("Vault/".length))!;
      const parsed = JSON.parse(Buffer.from(out).toString("utf8")) as JsonCanvas;
      const expected = JSON.parse(Buffer.from(file.bytes).toString("utf8")) as JsonCanvas;
      // The NFD image is stored at its NFC path, and the node follows it.
      const nfc = (c: JsonCanvas) => ({
        ...c,
        edges: c.edges ?? [],
        nodes: c.nodes.map((n) =>
          n.type === "file" && typeof n.file === "string" && /\.png$/.test(n.file)
            ? { ...n, file: n.file.normalize("NFC") }
            : n,
        ),
      });
      expect(nfc(parsed), file.path).toEqual(nfc(expected));
    }
  });

  // Two vault paths holding the same bytes share one upload, and the second
  // card is pointed at the first one's path without a repair line, so the
  // second file is missing from the export and nothing says why.
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

  it("keeps note bodies out of every .canvas file and every snapshot", async () => {
    const { exported, finals } = await roundTrip();
    for (const [path, bytes] of exported.files) {
      if (!path.endsWith(".canvas")) continue;
      const text = Buffer.from(bytes).toString("utf8");
      for (const marker of [
        "trailing",
        "starts with a BOM",
        "line one",
        "decomposed",
        "日本語のテキスト",
      ]) {
        expect(text, path).not.toContain(marker);
      }
    }
    for (const final of finals) {
      const doc = docOf(final.state);
      const snapshot = JSON.stringify(deriveSnapshot(doc));
      expect(snapshot).not.toContain("trailing");
      expect(snapshot).not.toContain("line one");
      expect(serializeCanvas(docToJsonCanvas(doc))).not.toContain("starts with a BOM");
    }
  });
});

// ── 3. Re-importing an export into the same scope uploads nothing ──────────

describe("exit 3: re-import into the same scope uploads zero images", () => {
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

// ── 4. Note bodies are byte-exact ───────────────────────────────────────────

describe("exit 4: note bodies are byte-exact", () => {
  const cases: [string, Uint8Array][] = [
    ["BOM", new Uint8Array([0xef, 0xbb, 0xbf, ...enc("bom\n")])],
    ["BOM only", new Uint8Array([0xef, 0xbb, 0xbf])],
    ["two BOMs", new Uint8Array([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, ...enc("x")])],
    ["CRLF", enc("a\r\nb\r\n")],
    ["lone CR", enc("a\rb\r")],
    ["mixed endings", enc("a\nb\r\nc\rd")],
    ["trailing whitespace", enc("a   \n\t \n   ")],
    ["empty", new Uint8Array()],
    ["NUL and controls", enc("a\u0000b\u0007c\u001b")],
    ["U+2028 and NBSP", enc("a b c")],
    ["astral and ZWJ", enc("🧑‍💻 𝔘𝔫𝔦𝔠𝔬𝔡𝔢")],
    ["NFD inside", enc("é")],
  ];

  it.each(cases)("%s survives import → doc → vault export", async (_label, bytes) => {
    const scope = memoryScope();
    const canvas = {
      nodes: [{ id: "f", type: "file", file: "n.md", x: 0, y: 0, width: 10, height: 10 }],
      edges: [],
    };
    const { finals, result } = await importFiles(scope, [
      { path: "c.canvas", bytes: enc(JSON.stringify(canvas)) },
      { path: "n.md", bytes },
    ]);
    expect(result.report.notesAttached).toBe(1);
    const doc = docOf(finals[0]!.state);
    const node = canvasNodes(doc).get(finals[0]!.canvas.nodes[0]!.id) as Y.Map<unknown>;
    const body = fileBodyOf(node)!;
    expect(body.bom === true).toBe(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf);
    const out = buildVaultExport(doc, { canvasPath: "c.canvas", attachments: {} });
    const note = out.files.find((f) => f.path === "n.md")!;
    expect(Buffer.from(note.bytes!).equals(Buffer.from(bytes))).toBe(true);
    expect(JSON.stringify(deriveSnapshot(doc))).not.toContain('"bom"');
  });

  it("a non-UTF-8 note keeps the 'not included' state and is reported", async () => {
    const scope = memoryScope();
    const canvas = {
      nodes: [{ id: "f", type: "file", file: "latin1.md", x: 0, y: 0, width: 10, height: 10 }],
    };
    const { finals, result } = await importFiles(scope, [
      { path: "c.canvas", bytes: enc(JSON.stringify(canvas)) },
      { path: "latin1.md", bytes: new Uint8Array([0x63, 0x61, 0x66, 0xe9]) },
    ]);
    expect(result.report.skipped.find((s) => s.path === "latin1.md")?.reason).toMatch(/UTF-8/);
    const doc = docOf(finals[0]!.state);
    expect(fileBodyOf(canvasNodes(doc).get("f") as Y.Map<unknown>)).toBeUndefined();
  });

  it("the Markdown export carries bodies; the outline otherwise matches", async () => {
    const scope = memoryScope();
    const canvas = {
      nodes: [
        { id: "t", type: "text", text: "Intro", x: 0, y: 0, width: 10, height: 10 },
        { id: "f", type: "file", file: "n.md", x: 0, y: 50, width: 10, height: 10 },
      ],
    };
    const { finals } = await importFiles(scope, [
      { path: "c.canvas", bytes: enc(JSON.stringify(canvas)) },
      { path: "n.md", bytes: enc("# Body heading\r\nline\r\n") },
    ]);
    const md = canvasMarkdown(docOf(finals[0]!.state));
    expect(md).toContain("Intro");
    expect(md).toContain("Body heading");
  });
});

// ── 5. Oversize imports are refused up front, with the numbers ──────────────

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

describe("exit 5: oversize imports are refused before any upload or canvas", () => {
  it("more than maxNodes cards on a new canvas", async () => {
    const error = await refusedWith([
      { path: "big.canvas", bytes: textCanvas(CANVAS_LIMITS.maxNodes + 1) },
      { path: "a.png", bytes: PNG },
    ]);
    expect(error.limit).toBe("maxNodes");
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
    // 300 cards of 19,000 characters: under every per-card cap, over the 5 MB state cap.
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
    expect(error.limit).toBe("maxImagesPerImport");
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

// ── The Markdown seam: every .md goes through it ────────────────────────────

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
    const { readdirSync } = await import("node:fs");
    const dir = join(import.meta.dirname, "..");
    const routesMarkdown =
      /endsWith\(\s*["'`]\.md|\\\.md\b|===\s*["'`]note["'`]|["'`]note["'`]\s*===/;
    const offenders = readdirSync(dir)
      .filter((f) => /\.(ts|tsx)$/.test(f) && f !== "markdown-seam.ts")
      .filter((f) => routesMarkdown.test(readFileSync(join(dir, f), "utf8")));
    expect(offenders).toEqual([]);
  });
});
