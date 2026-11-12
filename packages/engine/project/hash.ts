import type { Sha256 } from "./types";

export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** SHA-256 of `data` as 64 lowercase hex characters; a string is hashed as its UTF-8 bytes. */
export async function sha256(data: Uint8Array | string): Promise<Sha256> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  let out = "";
  for (const b of new Uint8Array(digest)) out += b.toString(16).padStart(2, "0");
  return out;
}

export function isSha256(s: string): s is Sha256 {
  return SHA256_PATTERN.test(s);
}
