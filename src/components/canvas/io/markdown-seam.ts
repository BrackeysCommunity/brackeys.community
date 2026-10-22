/**
 * Where every imported `.md` goes. Notes aren't documents of their own yet,
 * so today a note a canvas references becomes the inline body of its `file`
 * card, and a lone `.md` dropped on a canvas becomes a text card.
 *
 * This is the one module import code asks about Markdown. When notes become
 * documents, this module is replaced: a note is
 * created or reused by path in the target scope, and the canvas gets a
 * `note` card pointing at it. Nothing else in `io/` checks for `.md`.
 *
 * Pure: runs in the `canvas-io` worker and in node tests.
 */
import type { FileBody } from "@/lib/canvas/json-canvas";
import { CANVAS_IMPORT_LIMITS, CANVAS_LIMITS } from "@/lib/canvas/limits";
import { pathKind } from "@/lib/canvas/paths";

const BOM = [0xef, 0xbb, 0xbf] as const;

export function isMarkdownPath(path: string): boolean {
  return pathKind(path) === "note";
}

function hasBom(bytes: Uint8Array): boolean {
  return bytes[0] === BOM[0] && bytes[1] === BOM[1] && bytes[2] === BOM[2];
}

/**
 * A note's text exactly as stored: the byte order mark recorded rather than
 * kept, line endings and trailing whitespace untouched. Null when the bytes
 * aren't UTF-8, since such a body couldn't be written back unchanged.
 */
export function decodeNote(bytes: Uint8Array): FileBody | null {
  const bom = hasBom(bytes);
  try {
    // ignoreBOM: the mark is handled above, never silently eaten.
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bom ? bytes.subarray(3) : bytes,
    );
    return bom ? { text, bom: true } : { text };
  } catch {
    return null;
  }
}

/** The file a body came from, byte for byte. */
export function encodeNote(body: FileBody): Uint8Array {
  const text = new TextEncoder().encode(body.text);
  if (!body.bom) return text;
  const out = new Uint8Array(text.length + 3);
  out.set(BOM);
  out.set(text, 3);
  return out;
}

export type MarkdownPlacement =
  | { kind: "inline-body"; body: FileBody }
  | { kind: "text-card"; text: string; truncated: boolean }
  | { kind: "skipped"; reason: string };

/**
 * A note referenced by a `file` node on an imported canvas: its body rides
 * inline on that card.
 */
export function placeReferencedNote(bytes: Uint8Array): MarkdownPlacement {
  if (bytes.length > CANVAS_IMPORT_LIMITS.maxMarkdownBytes) {
    return {
      kind: "skipped",
      reason: `Note is ${formatBytes(bytes.length)}, over the ${formatBytes(CANVAS_IMPORT_LIMITS.maxMarkdownBytes)} a note can bring in.`,
    };
  }
  const body = decodeNote(bytes);
  return body
    ? { kind: "inline-body", body }
    : { kind: "skipped", reason: "Note isn't UTF-8 text." };
}

/** A `.md` brought in on its own, not referenced by any canvas: a text card. */
export function placeLoneNote(bytes: Uint8Array): MarkdownPlacement {
  // A text card is the note's text, not its file: a lenient decode is fine.
  const text = new TextDecoder().decode(bytes.subarray(0, CANVAS_IMPORT_LIMITS.maxMarkdownBytes));
  const truncated =
    text.length > CANVAS_LIMITS.maxCardText || bytes.length > CANVAS_IMPORT_LIMITS.maxMarkdownBytes;
  return { kind: "text-card", text: text.slice(0, CANVAS_LIMITS.maxCardText), truncated };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}
