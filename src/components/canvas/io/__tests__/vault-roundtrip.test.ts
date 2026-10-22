/**
 * Imports and exports end to end: a `.canvas` file through the canvas
 * menu's export and back, and a whole vault zip through "Import from
 * Obsidian" and "Export for Obsidian", byte for byte.
 */
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
import { pathKey } from "@/lib/canvas/paths";

import { buildVaultExport, serializeCanvas } from "../vault-export";
import { unzipVault, zipVault } from "../vault-zip";
import {
  ALL_FIXTURES,
  docOf,
  exportCanvas,
  exportVault,
  importFiles,
  NFD_IMAGE,
  raw,
  syntheticVault,
} from "./import-harness";
import { enc, memoryScope } from "./vault-fixtures";

vi.mock("@/orpc/client", () => ({ client: {} }));

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

describe(".canvas export and re-import", () => {
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

describe("a vault zip, imported and exported for Obsidian", () => {
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
      if (inVault === "Art/embedded-only.png") continue; // embeds aren't uploaded
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

  // jcv-demo was re-serialised by a plugin; the NFD image path is stored,
  // and so written, in NFC.
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
  it("leaves Obsidian's settings, trash and the zip's junk out", () => {
    expect(unzipVault(zipVault(syntheticVault())).ignored).toBe(4);
  });
});

describe("note bodies through an import and a vault export", () => {
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
});
