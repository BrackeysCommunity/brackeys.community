import { makeIssue } from "../scene/issues";
import type { SceneIssue } from "../scene/types";
import { isSha256, sha256 } from "./hash";
import type { Sha256 } from "./types";

/** Bytes by content hash: dev keeps them in the cache dir, the site in object storage. */
export type ContentStore = {
  has(hash: Sha256): Promise<boolean>;
  get(hash: Sha256): Promise<Uint8Array | null>;
  /** Stores bytes and returns their hash; refuses with `hash-mismatch` when `expect` differs. */
  put(bytes: Uint8Array, expect?: Sha256): Promise<Sha256>;
};

/** A store's refusal, carrying the issue (`hash-mismatch`) it was refused with. */
export class ContentStoreError extends Error {
  constructor(readonly issue: SceneIssue) {
    super(issue.message);
    this.name = "ContentStoreError";
  }
}

/** The hash of `bytes`, refused with `hash-mismatch` when it isn't `expect`; for every store's `put`. */
export async function hashForPut(bytes: Uint8Array, expect?: Sha256): Promise<Sha256> {
  const hash = await sha256(bytes);
  if (expect !== undefined && expect !== hash) {
    throw new ContentStoreError(
      makeIssue("hash-mismatch", {
        message: isSha256(expect)
          ? `The bytes hash to ${hash}, not the expected ${expect}.`
          : `"${String(expect)}" isn't a SHA-256 hash; the bytes hash to ${hash}.`,
        expected: expect,
        got: hash,
      }),
    );
  }
  return hash;
}

/** An in-memory store for tests and headless runs; it keeps its own copies, so callers may reuse their buffers. */
export function memoryContentStore(): ContentStore {
  const blobs = new Map<Sha256, Uint8Array>();
  return {
    async has(hash) {
      return blobs.has(hash);
    },
    async get(hash) {
      const bytes = blobs.get(hash);
      return bytes ? bytes.slice() : null;
    },
    async put(bytes, expect) {
      const hash = await hashForPut(bytes, expect);
      if (!blobs.has(hash)) blobs.set(hash, bytes.slice());
      return hash;
    },
  };
}
