// @vitest-environment jsdom
// jsdom on purpose: the store and its hashing must run where only crypto.subtle is.
import { createHash } from "node:crypto";

import { describe, expect, it } from "vite-plus/test";

import { ContentStoreError, memoryContentStore } from "../content-store";
import { sha256 } from "../hash";

const bytesOf = (text: string) => new TextEncoder().encode(text);
const nodeSha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("memoryContentStore", () => {
  it("runs in a browser-like environment", () => {
    expect(typeof window).toBe("object");
    expect(typeof globalThis.crypto.subtle.digest).toBe("function");
  });

  it("puts bytes under their sha256 and gets them back", async () => {
    const store = memoryContentStore();
    const bytes = bytesOf("crate.png bytes");
    const hash = await store.put(bytes);
    expect(hash).toBe(nodeSha(bytes));
    expect(hash).toBe(await sha256(bytes));
    expect(await store.has(hash)).toBe(true);
    expect(await store.get(hash)).toEqual(bytes);
  });

  it("answers has and get for a hash it doesn't hold", async () => {
    const store = memoryContentStore();
    const hash = await sha256("never stored");
    expect(await store.has(hash)).toBe(false);
    expect(await store.get(hash)).toBeNull();
    expect(await store.has("not a hash")).toBe(false);
  });

  it("accepts a matching expect and refuses a mismatched one with hash-mismatch", async () => {
    const store = memoryContentStore();
    const bytes = bytesOf("tiles");
    expect(await store.put(bytes, nodeSha(bytes))).toBe(nodeSha(bytes));

    const other = bytesOf("other");
    const wrong = nodeSha(bytesOf("something else"));
    const refusal = await store.put(other, wrong).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(ContentStoreError);
    expect((refusal as ContentStoreError).issue).toMatchObject({
      code: "hash-mismatch",
      severity: "error",
      expected: wrong,
      got: nodeSha(other),
    });
    expect(await store.has(nodeSha(other))).toBe(false);
    await expect(store.put(other, "zz")).rejects.toMatchObject({
      issue: { code: "hash-mismatch" },
    });
  });

  it("keeps its own copies, so callers may reuse their buffers", async () => {
    const store = memoryContentStore();
    const bytes = bytesOf("mutable");
    const hash = await store.put(bytes);
    bytes[0] = 0;
    const got = (await store.get(hash))!;
    expect(nodeSha(got)).toBe(hash);
    got[1] = 0;
    expect(nodeSha((await store.get(hash))!)).toBe(hash);
  });

  it("stores a view's bytes only, and the same bytes once", async () => {
    const store = memoryContentStore();
    const buffer = bytesOf("..payload..");
    const view = buffer.subarray(2, 9);
    const hash = await store.put(view);
    expect(hash).toBe(nodeSha(bytesOf("payload")));
    expect(await store.put(bytesOf("payload"))).toBe(hash);
    expect(await store.get(hash)).toEqual(bytesOf("payload"));
  });

  it("stores empty bytes", async () => {
    const store = memoryContentStore();
    const hash = await store.put(new Uint8Array(0));
    expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect((await store.get(hash))!.byteLength).toBe(0);
  });
});
