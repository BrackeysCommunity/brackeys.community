import { formatScene } from "./format";
import type { SceneDefinition, SceneHash } from "./types";

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a32(bytes: Uint8Array, basis: number): number {
  let h = basis >>> 0;
  for (const byte of bytes) h = Math.imul(h ^ byte, FNV_PRIME) >>> 0;
  return h;
}

const hex8 = (n: number) => n.toString(16).padStart(8, "0");

/** 16 hex characters: two FNV-1a 32 passes over the UTF-8 text. */
export function hashText(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return hex8(fnv1a32(bytes, FNV_OFFSET)) + hex8(fnv1a32(bytes, (FNV_OFFSET ^ 0x9e3779b9) >>> 0));
}

/** `hashText` of the canonical text. */
export function sceneHash(def: SceneDefinition): SceneHash {
  return hashText(formatScene(def).text);
}
