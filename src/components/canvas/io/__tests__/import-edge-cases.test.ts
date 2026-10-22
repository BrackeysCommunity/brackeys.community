/**
 * Edge cases around the import and export paths: Obsidian's own layout
 * after the canvas has been stored, merged and edited; malformed key orders
 * in the doc; the paste size check being exact; plain-text paste line breaks.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { docFromState, mergeStates } from "@/lib/canvas/doc-state";
import {
  applyJsonCanvas,
  canvasNodes,
  docToJsonCanvas,
  type JsonCanvas,
} from "@/lib/canvas/json-canvas";

import { runImportJob } from "../canvas-io-jobs";
import { readCanvasClipboard, stateBytesWith } from "../clipboard";
import { finalizeCanvases, resolveImages } from "../import-flow";
import { buildVaultExport, serializeCanvas } from "../vault-export";
import { zipVault } from "../vault-zip";
import { entry, FIXTURES, memoryScope } from "./vault-fixtures";

vi.mock("@/orpc/client", () => ({ client: {} }));

/** Obsidian-written per the fixtures' SOURCES.md (plus quartz, hand-written in Obsidian's layout). */
const OBSIDIAN_WRITTEN = [
  "candy-db.canvas",
  "candy-network.canvas",
  "candy-stakeholder.canvas",
  "customframes.canvas",
  "dvdd-movies.canvas",
  "jsoncanvas-sample.canvas",
  "obsidiantools-crazywall.canvas",
  "quartz-test.canvas",
  "siyuan-deductive-logic.canvas",
  "siyuan-large-talk.canvas",
  "zk-links.canvas",
];
const raw = (name: string) => readFileSync(join(FIXTURES, name));
const EMPTY = Y.encodeStateAsUpdate(new Y.Doc());

async function importState(files: { path: string; bytes: Uint8Array }[] | Uint8Array) {
  const source =
    files instanceof Uint8Array
      ? { zip: new Blob([files as Uint8Array<ArrayBuffer>]) }
      : {
          files: files.map((f) => ({
            path: f.path,
            file: new Blob([f.bytes as Uint8Array<ArrayBuffer>]),
          })),
        };
  const scope = memoryScope();
  const result = await runImportJob({ source, options: { mode: "new" } });
  if (result.kind !== "import") throw new Error("expected an import");
  const images = await resolveImages(result.canvases, result.images, scope.uploader);
  return { scope, finals: finalizeCanvases(result.canvases, result.images, images.resolved) };
}

const exportDoc = (doc: Y.Doc) => serializeCanvas(docToJsonCanvas(doc));

describe(
  "Obsidian-written .canvas files after storing and live merges",
  { timeout: 60_000 },
  () => {
    it.each(OBSIDIAN_WRITTEN)(
      "%s exports byte for byte after the server stores it",
      async (name) => {
        const { finals } = await importState([{ path: name, bytes: raw(name) }]);
        // As createCanvas stores it, then as canvas-sync merges a second client's (empty) state in.
        const stored = mergeStates(EMPTY, finals[0]!.state);
        const reloaded = docFromState(mergeStates(stored, Y.encodeStateAsUpdate(new Y.Doc())));
        expect(exportDoc(reloaded)).toBe(raw(name).toString("utf8"));
      },
    );

    it("every Obsidian-written fixture in one vault zip comes back byte for byte", async () => {
      const zip = zipVault(
        OBSIDIAN_WRITTEN.map((name) => entry(`Vault/Boards/${name}`, raw(name))),
      );
      const { finals, scope } = await importState(zip);
      expect(finals).toHaveLength(OBSIDIAN_WRITTEN.length);
      for (const final of finals) {
        const built = buildVaultExport(docFromState(final.state), {
          canvasPath: final.targetPath,
          attachments: scope.attachments(),
        });
        const name = final.targetPath.split("/").pop()!;
        const out = built.files.find((f) => f.path === final.targetPath)!;
        expect(new TextDecoder().decode(out.bytes!), name).toBe(raw(name).toString("utf8"));
      }
    });

    it("edits after the import keep Obsidian's layout and land in the JSON", async () => {
      const name = "obsidiantools-crazywall.canvas";
      const { finals } = await importState([{ path: name, bytes: raw(name) }]);
      const doc = docFromState(finals[0]!.state);
      const source = JSON.parse(raw(name).toString("utf8")) as JsonCanvas;
      const nodes = canvasNodes(doc);
      const plain = source.nodes.find((n) => n.color === undefined)!;
      const colored = source.nodes.find((n) => n.color !== undefined)!;
      nodes.get(plain.id)!.set("color", "3");
      nodes.get(colored.id)!.delete("color");
      nodes.get(source.nodes[0]!.id)!.set("x", source.nodes[0]!.x + 7);
      const added = applyJsonCanvas(doc, {
        nodes: [{ id: "new", type: "text", text: "added\nline", x: 1, y: 2, width: 3, height: 4 }],
      }).created[0]!;

      const text = exportDoc(doc);
      const lines = text.split("\n");
      expect(lines[0]).toBe("{");
      expect(lines.at(-1)).toBe("}");
      const nodeLines = lines.filter((l) => l.startsWith("\t\t"));
      for (const line of nodeLines) expect(() => JSON.parse(line.replace(/,$/, ""))).not.toThrow();
      expect(nodeLines).toHaveLength(source.nodes.length + 1 + (source.edges?.length ?? 0));

      const out = JSON.parse(text) as JsonCanvas;
      const byId = new Map(out.nodes.map((n) => [n.id, n]));
      expect(byId.get(plain.id)!.color).toBe("3");
      expect(byId.get(colored.id)!.color).toBeUndefined();
      expect(byId.get(source.nodes[0]!.id)!.x).toBe(source.nodes[0]!.x + 7);
      expect(byId.get(added)).toMatchObject({ type: "text", text: "added\nline" });
      // Untouched cards keep their exact source line.
      const untouched = source.nodes.filter(
        (n) => ![plain.id, colored.id, source.nodes[0]!.id].includes(n.id),
      );
      for (const node of untouched) {
        expect(text).toContain(`\t\t${JSON.stringify(node)}`);
      }
    });

    it("a malformed key order in the doc never loses or invents a field", () => {
      const doc = new Y.Doc();
      applyJsonCanvas(
        doc,
        {
          nodes: [
            { id: "a", type: "text", text: "t", x: 1, y: 2, width: 3, height: 4, color: "1" },
          ],
          edges: [],
        },
        { mode: "whole" },
      );
      const node = canvasNodes(doc).get("a")!;
      for (const keys of [
        "id,type",
        [1, null, "__proto__", "nope", "color", "id"],
        ["color", "color", "id"],
        {},
        [],
      ]) {
        node.set("keys", keys);
        const out = JSON.parse(exportDoc(doc)) as JsonCanvas;
        expect(out.nodes[0]).toEqual({
          id: "a",
          type: "text",
          text: "t",
          x: 1,
          y: 2,
          width: 3,
          height: 4,
          color: "1",
        });
      }
    });

    it("stores no key order for a card already in our own order", () => {
      const doc = new Y.Doc();
      applyJsonCanvas(
        doc,
        {
          nodes: [{ id: "a", type: "text", text: "t", x: 1, y: 2, width: 3, height: 4 }],
          edges: [],
        },
        { mode: "whole" },
      );
      expect(canvasNodes(doc).get("a")!.has("keys")).toBe(false);
    });
  },
);

describe("the paste size check", () => {
  it("is the exact state size the paste makes, over many shapes of doc", () => {
    for (let trial = 0; trial < 25; trial++) {
      const doc = new Y.Doc();
      const other = new Y.Doc();
      applyJsonCanvas(other, {
        nodes: Array.from({ length: 1 + (trial % 7) }, (_, i) => ({
          id: `o${i}`,
          type: "text",
          text: "x".repeat(trial * 13 + i),
          x: i,
          y: 0,
          width: 1,
          height: 1,
        })),
      });
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(other));
      applyJsonCanvas(doc, {
        nodes: [
          { id: "mine", type: "text", text: "y".repeat(trial), x: 0, y: 0, width: 1, height: 1 },
        ],
      });
      // Churn: deletes and edits, from both clients.
      const first = [...canvasNodes(doc).keys()][0]!;
      if (trial % 2) canvasNodes(doc).delete(first);
      else canvasNodes(doc).get(first)!.set("x", trial);
      const fragment: JsonCanvas = {
        nodes: Array.from({ length: 1 + (trial % 4) }, (_, i) => ({
          id: `f${i}`,
          type: "text",
          text: "z".repeat(trial * 31 + i),
          x: i * 5,
          y: 1,
          width: 2,
          height: 2,
        })),
        edges: trial % 3 ? [] : [{ id: "e", fromNode: "f0", toNode: "f0" }],
      };
      const at = { x: trial, y: -trial };
      const predicted = stateBytesWith(doc, fragment, { at });
      applyJsonCanvas(doc, fragment, { at, origin: "local" });
      expect(predicted, `trial ${trial}`).toBe(Y.encodeStateAsUpdate(doc).length);
    }
  });
});

describe("plain text pasted onto the canvas (not into a card)", () => {
  it("becomes a text card with \\n line breaks, as a paste into a card does", () => {
    const read = readCanvasClipboard(
      (type) => (type === "text/plain" ? "one\r\ntwo\rthree" : ""),
      [],
    );
    expect(read).toEqual({ kind: "text", text: "one\ntwo\nthree" });
  });
});
