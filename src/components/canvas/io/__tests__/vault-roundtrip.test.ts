import { describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { deriveSnapshot } from "@/lib/canvas/json-canvas";
import { pathKey } from "@/lib/canvas/paths";

import { runImportJob } from "../canvas-io-jobs";
import { finalizeCanvases, resolveImages } from "../import-flow";
import { buildVaultExport } from "../vault-export";
import type { VaultEntry } from "../vault-import";
import { unzipVault, zipVault } from "../vault-zip";
import { canonical, enc, entry, fixture, GIF, memoryScope, PNG, WEBP } from "./vault-fixtures";

// The import flow's real uploader talks to the server; these tests use memoryScope.
vi.mock("@/orpc/client", () => ({ client: {} }));

const NFD_NAME = "Notes/Résumé.md".normalize("NFD");

/** A synthetic vault: fixture canvases, nested notes, odd names and encodings, tiny images. */
function syntheticVault(): VaultEntry[] {
  const board = {
    nodes: [
      { id: "a1", type: "file", file: "Notes/Ideas/Idea.md", x: 0, y: 0, width: 300, height: 200 },
      {
        id: "a2",
        type: "file",
        file: "Notes/Ideas/Idea.md",
        subpath: "#Second",
        x: 0,
        y: 300,
        width: 300,
        height: 200,
      },
      {
        id: "a3",
        type: "file",
        file: "Notes/日本語のメモ.md",
        x: 400,
        y: 0,
        width: 300,
        height: 200,
      },
      { id: "a4", type: "file", file: NFD_NAME, x: 800, y: 0, width: 300, height: 200 },
      { id: "a5", type: "file", file: "Notes/BOM.md", x: 1200, y: 0, width: 300, height: 200 },
      { id: "a6", type: "file", file: "Notes/CRLF.md", x: 1600, y: 0, width: 300, height: 200 },
      {
        id: "a7",
        type: "file",
        file: "attachments/pixel.png",
        x: 0,
        y: 600,
        width: 100,
        height: 100,
      },
      {
        id: "a8",
        type: "file",
        file: "attachments/pixel.gif",
        x: 200,
        y: 600,
        width: 100,
        height: 100,
      },
      {
        id: "a9",
        type: "file",
        file: "attachments/pixel.webp",
        x: 400,
        y: 600,
        width: 100,
        height: 100,
      },
      { id: "b1", type: "file", file: "Docs/spec.pdf", x: 600, y: 600, width: 100, height: 100 },
      { id: "b2", type: "file", file: "Views/tasks.base", x: 800, y: 600, width: 100, height: 100 },
      {
        id: "b3",
        type: "file",
        file: "Elsewhere/dup.md",
        x: 1000,
        y: 600,
        width: 100,
        height: 100,
      },
      { id: "b4", type: "text", text: "Plain card", x: 1200, y: 600, width: 200, height: 100 },
    ],
    edges: [{ id: "e1", fromNode: "a1", fromSide: "right", toNode: "a3", toSide: "left" }],
  };
  return [
    entry("My Vault/Boards/Board.canvas", canonical(board as never)),
    entry(
      "My Vault/Fixtures/crazywall.canvas",
      canonical(fixture("obsidiantools-crazywall.canvas")),
    ),
    entry("My Vault/Fixtures/sample.canvas", canonical(fixture("jsoncanvas-sample.canvas"))),
    entry("My Vault/Fixtures/jcv.canvas", canonical(fixture("jcv-demo.canvas"))),
    entry("My Vault/Notes/Ideas/Idea.md", "# Idea\n\n## Second\n\ntext with trailing   \n"),
    entry("My Vault/Notes/日本語のメモ.md", "# メモ\n日本語のテキスト\n"),
    entry(`My Vault/${NFD_NAME}`, "Résumé, decomposed\n"),
    entry(
      "My Vault/Notes/BOM.md",
      new Uint8Array([0xef, 0xbb, 0xbf, ...enc("starts with a BOM\n")]),
    ),
    entry("My Vault/Notes/CRLF.md", "line one\r\nline two  \r\n\r\n"),
    entry("My Vault/attachments/pixel.png", PNG),
    entry("My Vault/attachments/pixel.gif", GIF),
    entry("My Vault/attachments/pixel.webp", WEBP),
    entry("My Vault/Docs/spec.pdf", "%PDF-1.4"),
    entry("My Vault/Views/tasks.base", "views: []\n"),
    entry("My Vault/A/dup.md", "first"),
    entry("My Vault/B/dup.md", "second"),
    entry("My Vault/.obsidian/workspace.json", "{}"),
  ];
}

async function importInto(scope: ReturnType<typeof memoryScope>, zip: Uint8Array) {
  const result = await runImportJob({
    source: { zip: new Blob([zip as Uint8Array<ArrayBuffer>]) },
    options: { mode: "new" },
  });
  if (result.kind !== "import") throw new Error("expected an import");
  const images = await resolveImages(result.canvases, result.images, scope.uploader);
  return {
    result,
    images,
    finals: finalizeCanvases(result.canvases, result.images, images.resolved),
  };
}

function exportAll(
  scope: ReturnType<typeof memoryScope>,
  finals: { targetPath: string; state: Uint8Array }[],
) {
  const files = new Map<string, Uint8Array>();
  const leftOut: { path: string; reason: string }[] = [];
  for (const final of finals) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, final.state);
    const built = buildVaultExport(doc, {
      canvasPath: final.targetPath,
      attachments: scope.attachments(),
    });
    leftOut.push(...built.leftOut);
    for (const file of built.files) {
      files.set(file.path, file.bytes ?? scope.bytesAt(file.url!)!);
    }
  }
  return { files, leftOut };
}

describe("a vault zip, imported and exported for Obsidian", () => {
  it("comes back byte for byte, with everything left out reported", async () => {
    const source = syntheticVault();
    const scope = memoryScope();
    const { result, images, finals } = await importInto(scope, zipVault(source));

    expect(finals.map((f) => f.targetPath).sort()).toEqual([
      "Boards/Board.canvas",
      "Fixtures/crazywall.canvas",
      "Fixtures/jcv.canvas",
      "Fixtures/sample.canvas",
    ]);
    expect(images.uploaded).toBe(3);
    const reasons = new Map(result.report.skipped.map((s) => [s.path, s.reason]));
    expect(reasons.get("Docs/spec.pdf")).toMatch(/PDF/);
    expect(reasons.get("Views/tasks.base")).toMatch(/Bases/);
    expect(reasons.get("Elsewhere/dup.md")).toMatch(/2 files match/);

    const { files } = exportAll(scope, finals);
    const byKey = new Map([...files].map(([path, bytes]) => [pathKey(path), bytes]));
    const imported = source.filter(
      (e) =>
        !/\.(pdf|base)$/.test(e.path) &&
        !e.path.includes("/.obsidian/") &&
        !/\/[AB]\/dup\.md$/.test(e.path),
    );
    for (const file of imported) {
      const inVault = file.path.slice("My Vault/".length);
      const exported = byKey.get(pathKey(inVault));
      // Notes and images the crazywall fixture names aren't in this vault, and stay out.
      expect(exported, inVault).toBeDefined();
      expect(Buffer.from(exported!).equals(Buffer.from(file.bytes)), inVault).toBe(true);
    }
  });

  it("re-imports into the same scope without uploading anything again", async () => {
    const scope = memoryScope();
    const first = await importInto(scope, zipVault(syntheticVault()));
    const { files } = exportAll(scope, first.finals);
    const rows = scope.rows.length;

    const again = await importInto(
      scope,
      zipVault([...files].map(([path, bytes]) => ({ path, bytes }))),
    );
    expect(again.images.uploaded).toBe(0);
    expect(again.images.reused).toBe(3);
    expect(scope.rows.length).toBe(rows);
  });

  it("never stores a note body in the snapshot", async () => {
    const scope = memoryScope();
    const { finals } = await importInto(scope, zipVault(syntheticVault()));
    const board = finals.find((f) => f.targetPath === "Boards/Board.canvas")!;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, board.state);
    const snapshot = JSON.stringify(deriveSnapshot(doc));
    expect(snapshot).not.toContain("trailing");
    expect(snapshot).not.toContain("starts with a BOM");
  });

  it("leaves Obsidian's settings folder out", () => {
    const unzipped = unzipVault(zipVault(syntheticVault()));
    expect(unzipped.ignored).toBe(1);
  });
});
