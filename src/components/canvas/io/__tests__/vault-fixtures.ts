/** Shared test material for the vault import and export tests: tiny real images and helpers. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import * as Y from "yjs";

import { applyJsonCanvas, docToJsonCanvas, type JsonCanvas } from "@/lib/canvas/json-canvas";

import type { PreparedImage } from "../canvas-io-jobs";
import type { ImageUploader } from "../import-flow";
import { serializeCanvas } from "../vault-export";
import type { VaultEntry } from "../vault-import";

export const FIXTURES = join(import.meta.dirname, "../../../../lib/canvas/__tests__/fixtures");
/** Written before the rebrand; its key reads but is never written, so it can't round-trip. */
export const LEGACY_FIXTURE = "synthetic-brackeys.canvas";

export const fixtureNames = readdirSync(FIXTURES).filter(
  (f) => f.endsWith(".canvas") && f !== LEGACY_FIXTURE,
);

export function fixture(name: string): JsonCanvas {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as JsonCanvas;
}

export function normalized(canvas: JsonCanvas): JsonCanvas {
  const { jamsTeam: _key, ...rest } = canvas;
  return { ...rest, nodes: canvas.nodes ?? [], edges: canvas.edges ?? [] };
}

/** A canvas as our serialiser writes it: what a byte-for-byte round trip compares against. */
export function canonical(canvas: JsonCanvas): string {
  const doc = new Y.Doc();
  applyJsonCanvas(doc, canvas, { mode: "whole" });
  return serializeCanvas(docToJsonCanvas(doc));
}

export const enc = (s: string) => new TextEncoder().encode(s);

/** 1×1 PNG. */
export const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);
/** 1×1 GIF. */
export const GIF = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=="),
  (c) => c.charCodeAt(0),
);
/** 1×1 lossless WebP. */
export const WEBP = Uint8Array.from(atob("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=="), (c) =>
  c.charCodeAt(0),
);

export function entry(path: string, bytes: Uint8Array | string): VaultEntry {
  return { path, bytes: typeof bytes === "string" ? enc(bytes) : bytes };
}

/**
 * A scope's attachments in memory: uploads get an id and keep the path they
 * asked for (with ` 2` on a collision), and `match` answers like
 * `listCanvasAttachmentMatches`.
 */
export function memoryScope() {
  const rows: { id: string; path: string; sha256: string; bytes: Uint8Array }[] = [];
  let next = 1;
  const uploads: string[] = [];
  const uploader: ImageUploader = {
    match: async ({ attachmentIds, sha256s }) => {
      const byId: Record<string, { path: string; sha256: string }> = {};
      const bySha: Record<string, { id: string; path: string }> = {};
      for (const row of rows) {
        if (attachmentIds.includes(row.id)) byId[row.id] = { path: row.path, sha256: row.sha256 };
        if (sha256s.includes(row.sha256) && !bySha[row.sha256]) {
          bySha[row.sha256] = { id: row.id, path: row.path };
        }
      }
      return { byId, bySha };
    },
    upload: async (file, path) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = Array.from(new Uint8Array(digest), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      let final = path;
      for (let n = 2; rows.some((r) => r.path.toLowerCase() === final.toLowerCase()); n++) {
        final = path.replace(/(\.[^./]+)$/, ` ${n}$1`);
      }
      const id = `att-${next++}`;
      rows.push({ id, path: final, sha256, bytes });
      uploads.push(final);
      return { id, path: final, url: `/images/${id}` };
    },
  };
  const attachments = () =>
    Object.fromEntries(
      rows.map((r) => [r.id, { path: r.path, url: `/images/${r.id}`, quarantined: false }]),
    );
  const bytesAt = (url: string) => rows.find((r) => `/images/${r.id}` === url)?.bytes;
  return { rows, uploads, uploader, attachments, bytesAt };
}

export type { PreparedImage };
