// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { ContentStoreError } from "../../project/content-store";
import { DEV_CACHE_ROOT, defaultCacheDir, fileContentStore } from "../content-store";

const bytesOf = (text: string) => new TextEncoder().encode(text);
const nodeSha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "jams-content-store-"));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

describe("fileContentStore", () => {
  it("stores bytes at <cacheDir>/blobs/<sha256> and reads them back", async () => {
    const store = fileContentStore(cacheDir);
    const bytes = bytesOf("crate.png bytes");
    const hash = await store.put(bytes);
    expect(hash).toBe(nodeSha(bytes));
    expect(new Uint8Array(await readFile(join(cacheDir, "blobs", hash)))).toEqual(bytes);
    expect(await store.has(hash)).toBe(true);
    expect(await store.get(hash)).toEqual(bytes);
  });

  it("is durable: a new store over the same dir sees the blobs", async () => {
    const hash = await fileContentStore(cacheDir).put(bytesOf("tiles"));
    const again = fileContentStore(cacheDir);
    expect(await again.has(hash)).toBe(true);
    expect(await again.get(hash)).toEqual(bytesOf("tiles"));
  });

  it("answers has and get for a hash it doesn't hold, before the dir exists", async () => {
    const store = fileContentStore(join(cacheDir, "not-yet"));
    const hash = nodeSha(bytesOf("never stored"));
    expect(await store.has(hash)).toBe(false);
    expect(await store.get(hash)).toBeNull();
  });

  it("never reads outside blobs/ for a key that isn't a hash", async () => {
    await writeFile(join(cacheDir, "secret"), "x");
    const store = fileContentStore(cacheDir);
    await store.put(bytesOf("anything"));
    for (const key of ["../secret", "not a hash", "", nodeSha(bytesOf("a")).toUpperCase()]) {
      expect(await store.has(key)).toBe(false);
      expect(await store.get(key)).toBeNull();
    }
  });

  it("accepts a matching expect and refuses a mismatched one with hash-mismatch, writing nothing", async () => {
    const store = fileContentStore(cacheDir);
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
    expect(await store.has(wrong)).toBe(false);
    await expect(store.put(other, "zz")).rejects.toMatchObject({
      issue: { code: "hash-mismatch" },
    });
    expect(await readdir(join(cacheDir, "blobs"))).toEqual([nodeSha(bytes)]);
  });

  it("writes atomically: no temp file is left, and concurrent puts of one blob agree", async () => {
    const store = fileContentStore(cacheDir);
    const bytes = new Uint8Array(256 * 1024).map((_, i) => i % 251);
    const hashes = await Promise.all(Array.from({ length: 8 }, () => store.put(bytes)));
    expect(new Set(hashes)).toEqual(new Set([nodeSha(bytes)]));
    expect(await readdir(join(cacheDir, "blobs"))).toEqual([nodeSha(bytes)]);
    expect(nodeSha((await store.get(nodeSha(bytes)))!)).toBe(nodeSha(bytes));
  });

  it("stores a view's bytes only, and the same bytes once", async () => {
    const store = fileContentStore(cacheDir);
    const buffer = bytesOf("..payload..");
    const hash = await store.put(buffer.subarray(2, 9));
    expect(hash).toBe(nodeSha(bytesOf("payload")));
    expect(await store.put(bytesOf("payload"))).toBe(hash);
    expect(await store.get(hash)).toEqual(bytesOf("payload"));
    expect(await readdir(join(cacheDir, "blobs"))).toHaveLength(1);
  });

  it("hands out its own copies", async () => {
    const store = fileContentStore(cacheDir);
    const bytes = bytesOf("mutable");
    const hash = await store.put(bytes);
    bytes[0] = 0;
    const got = (await store.get(hash))!;
    got[1] = 0;
    expect(nodeSha((await store.get(hash))!)).toBe(hash);
  });

  it("stores empty bytes", async () => {
    const store = fileContentStore(cacheDir);
    const hash = await store.put(new Uint8Array(0));
    expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect((await store.get(hash))!.byteLength).toBe(0);
  });
});

describe("defaultCacheDir", () => {
  it("is node_modules/.cache/jams-engine/<project> under the root", () => {
    expect(DEV_CACHE_ROOT).toBe("node_modules/.cache/jams-engine");
    expect(defaultCacheDir("platformer", "/repo")).toBe(
      join("/repo", "node_modules", ".cache", "jams-engine", "platformer"),
    );
    expect(defaultCacheDir("engine")).toBe(
      join(process.cwd(), "node_modules/.cache/jams-engine/engine"),
    );
  });

  it("refuses a project id that isn't an id", () => {
    expect(() => defaultCacheDir("../escape", "/repo")).toThrow(/doesn't match/);
  });
});
