/**
 * An in-memory `saveCanvasImport` with the server's rules: merge what the
 * tab holds, keep it as the `pre-import` version, merge the import, refuse
 * the whole import over a cap, reply with what the tab is missing.
 */
import * as Y from "yjs";

import { base64ToBytes, bytesToBase64 } from "@/lib/canvas/encoding";
import { canvasNodes } from "@/lib/canvas/json-canvas";
import { CANVAS_LIMITS } from "@/lib/canvas/limits";

export interface FakeImportServer {
  /** What's stored. Write to it to stand in for a collaborator's stored edits. */
  stored: Y.Doc;
  versions: Uint8Array[];
  calls: { base: Uint8Array; update: Uint8Array }[];
  saveCanvasImport: (input: {
    canvasId: string;
    base: string;
    update: string;
    stateVector: string;
  }) => Promise<{ update: string; stateVector: string }>;
}

export function fakeImportServer(initial?: Y.Doc): FakeImportServer {
  const stored = new Y.Doc();
  if (initial) Y.applyUpdate(stored, Y.encodeStateAsUpdate(initial));
  const server: FakeImportServer = {
    stored,
    versions: [],
    calls: [],
    saveCanvasImport: async (input) => {
      await Promise.resolve();
      const base = base64ToBytes(input.base);
      const update = base64ToBytes(input.update);
      server.calls.push({ base, update });
      const next = new Y.Doc();
      Y.applyUpdate(next, Y.encodeStateAsUpdate(stored));
      Y.applyUpdate(next, base);
      const before = Y.encodeStateAsUpdate(next);
      Y.applyUpdate(next, update);
      const nodes = canvasNodes(next).size;
      const bytes = Y.encodeStateAsUpdate(next).length;
      if (nodes > CANVAS_LIMITS.maxNodes || bytes > CANVAS_LIMITS.maxStateBytes) {
        throw Object.assign(
          new Error(`This import would bring the canvas to ${nodes} cards. Nothing was imported.`),
          { code: "PAYLOAD_TOO_LARGE" },
        );
      }
      server.versions.push(before);
      Y.applyUpdate(stored, Y.encodeStateAsUpdate(next));
      return {
        update: bytesToBase64(
          Y.diffUpdate(Y.encodeStateAsUpdate(stored), base64ToBytes(input.stateVector)),
        ),
        stateVector: bytesToBase64(Y.encodeStateVector(stored)),
      };
    },
  };
  return server;
}
