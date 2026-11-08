import { ContentStoreError, sha256 } from "@jams/engine/project";
import { describe, expect, it, vi } from "vite-plus/test";

import { minioContentStore } from "../content-store";
import { fakeMinio, isMissingObjectError } from "./fake-minio";

vi.mock("@/lib/profile-project-image-storage", async () => {
  const { isMissingObjectError } = await import("./fake-minio");
  return {
    getMinioClient: () => {
      throw new Error("tests pass their own client");
    },
    isMissingObject: isMissingObjectError,
  };
});

const bytes = (text: string) => new TextEncoder().encode(text);

function store() {
  const minio = fakeMinio();
  return { ...minio, store: minioContentStore("kitchen", { client: minio.client, bucket: "b" }) };
}

describe("minioContentStore", () => {
  it("keys blobs by project and hash, under the engine-assets prefix", async () => {
    const { store: s, objects } = store();
    const hash = await s.put(bytes("crate"), undefined, { contentType: "image/png" });
    expect(hash).toBe(await sha256("crate"));
    expect(s.keyOf(hash)).toBe(`engine-assets/kitchen/${hash}`);
    expect([...objects.keys()]).toEqual([`b/engine-assets/kitchen/${hash}`]);
    expect(objects.get(`b/engine-assets/kitchen/${hash}`)?.meta).toEqual({
      "Content-Type": "image/png",
    });
  });

  it("reads back what it stored, and knows what it holds", async () => {
    const { store: s } = store();
    const hash = await s.put(bytes("some longer bytes to split"));
    expect(await s.has(hash)).toBe(true);
    expect(new TextDecoder().decode((await s.get(hash))!)).toBe("some longer bytes to split");
    const other = await sha256("absent");
    expect(await s.has(other)).toBe(false);
    expect(await s.get(other)).toBeNull();
  });

  it("refuses bytes whose hash isn't the claimed one, storing nothing", async () => {
    const { store: s, objects } = store();
    const wrong = await sha256("something else");
    const error = await s.put(bytes("crate"), wrong).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ContentStoreError);
    expect((error as ContentStoreError).issue).toMatchObject({
      code: "hash-mismatch",
      expected: wrong,
      got: await sha256("crate"),
    });
    expect(objects.size).toBe(0);
  });

  it("accepts a matching claim and defaults the content type", async () => {
    const { store: s, objects } = store();
    const hash = await s.put(bytes("crate"), await sha256("crate"));
    expect(objects.get(`b/${s.keyOf(hash)}`)?.meta["Content-Type"]).toBe(
      "application/octet-stream",
    );
  });

  it("keeps projects apart", async () => {
    const minio = fakeMinio();
    const a = minioContentStore("a", { client: minio.client, bucket: "b" });
    const b = minioContentStore("b", { client: minio.client, bucket: "b" });
    const hash = await a.put(bytes("only a"));
    expect(await b.has(hash)).toBe(false);
  });

  it("lets storage errors other than a missing object through", async () => {
    const { store: s, client } = store();
    client.failNext = Object.assign(new Error("down"), { code: "ECONNREFUSED" });
    await expect(s.has(await sha256("x"))).rejects.toThrow("down");
    expect(isMissingObjectError(client.failNext)).toBe(false);
  });
});
