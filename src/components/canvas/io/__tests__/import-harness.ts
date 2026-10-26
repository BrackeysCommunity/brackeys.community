/**
 * Whole imports and exports as the dialog and the canvas menu run them: the
 * worker's job (in the page), the image matching and uploads against a
 * `memoryScope`, the final states, and the vault export. Test files using it
 * mock `@/orpc/client`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as Y from "yjs";

import { docToJsonCanvas } from "@/lib/canvas/json-canvas";

import { runImportJob } from "../canvas-io-jobs";
import { finalizeCanvases, resolveImages } from "../import-flow";
import { serializeCanvas } from "../vault-export";
import type { VaultEntry, VaultImportOptions } from "../vault-import";
import {
  enc,
  entry,
  FIXTURES,
  fixtureNames,
  flatVaultExport,
  GIF,
  LEGACY_FIXTURE,
  type memoryScope,
  PNG,
  WEBP,
} from "./vault-fixtures";

export type Scope = ReturnType<typeof memoryScope>;

export const ALL_FIXTURES = [...fixtureNames, LEGACY_FIXTURE].sort();
export const raw = (name: string) => readFileSync(join(FIXTURES, name));

/** Every fixture Obsidian itself wrote (jcv-demo was re-serialised by a plugin). */
export const OBSIDIAN_WRITTEN = ALL_FIXTURES.filter(
  (name) => !name.startsWith("synthetic-") && name !== "jcv-demo.canvas",
);

export const docOf = (state: Uint8Array) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
};

/** The canvas menu's "Export .canvas": the doc's JSON Canvas, tab-indented. */
export const exportCanvas = (state: Uint8Array) => serializeCanvas(docToJsonCanvas(docOf(state)));

/** A whole import: the job, then images, then the final states. */
export async function importFiles(
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

/** "Export for Obsidian" over every imported canvas, images fetched from the scope. */
export function exportVault(scope: Scope, finals: { targetPath: string; state: Uint8Array }[]) {
  const files = new Map<string, Uint8Array>();
  const leftOut: { path: string; reason: string }[] = [];
  for (const final of finals) {
    const built = flatVaultExport(docOf(final.state), {
      canvasPath: final.targetPath,
      attachments: scope.attachments(),
    });
    leftOut.push(...built.leftOut);
    for (const file of built.files) files.set(file.path, file.bytes ?? scope.bytesAt(file.url!)!);
  }
  return { files, leftOut };
}

/** Exactly how Obsidian writes a canvas: tab-indented, one item per line, no final newline. */
export function obsidianLayout(canvas: { nodes: object[]; edges: object[] }): string {
  const list = (items: object[]) =>
    items.length ? `[\n${items.map((i) => `\t\t${JSON.stringify(i)}`).join(",\n")}\n\t]` : "[]";
  return `{\n\t"nodes":${list(canvas.nodes)},\n\t"edges":${list(canvas.edges)}\n}`;
}

export const NFD_NOTE = "Notes/Résumé café.md".normalize("NFD");
export const NFD_IMAGE = "Art/naïve.png".normalize("NFD");

const file = (id: string, path: string, x: number, y: number, size = 300) => ({
  id,
  x,
  y,
  width: size,
  height: size === 300 ? 200 : size,
  type: "file",
  file: path,
});

const board = {
  nodes: [
    file("n01", "Notes/Deep/Nest/Idea.md", 0, 0),
    { ...file("n02", "Notes/Deep/Nest/Idea.md", 0, 300), subpath: "#Second heading" },
    file("n03", "日本語/メモ.md", 400, 0),
    file("n04", NFD_NOTE, 800, 0),
    file("n05", "Notes/BOM.md", 1200, 0),
    file("n06", "Notes/CRLF.md", 1600, 0),
    file("n07", "Art/pixel.png", 0, 600, 100),
    file("n08", "Art/anim.gif", 200, 600, 100),
    file("n09", "Art/tiny.webp", 400, 600, 100),
    file("n10", NFD_IMAGE, 600, 600, 100),
    file("n11", "Docs/spec.pdf", 800, 600, 100),
    file("n12", "Views/tasks.base", 1000, 600, 100),
    file("n13", "dup.md", 1200, 600, 100),
    file("n14", "Gone/missing.md", 1400, 600, 100),
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

export const NOTES: Record<string, Uint8Array> = {
  "Notes/Deep/Nest/Idea.md": enc("# Idea\n\n## Second heading\n\ntext with trailing   \n\t\n"),
  "日本語/メモ.md": enc("# メモ\n日本語のテキスト\n![[Art/embedded-only.png]]\n"),
  [NFD_NOTE]: enc("Résumé, decomposed\n"),
  "Notes/BOM.md": new Uint8Array([0xef, 0xbb, 0xbf, ...enc("starts with a BOM\r\n")]),
  "Notes/CRLF.md": enc("line one\r\nline two  \r\n\r\nno newline at end"),
};

/**
 * A vault as Obsidian leaves it: a board in Obsidian's layout, three fixture
 * canvases, nested and oddly named or encoded notes, tiny images, files a
 * canvas can't hold, an ambiguous name, and the junk a zip picks up.
 */
export function syntheticVault(canvasBytes: (name: string) => Uint8Array = raw): VaultEntry[] {
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
