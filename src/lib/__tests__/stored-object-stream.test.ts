import { Readable } from "node:stream";

import { describe, expect, it } from "vite-plus/test";

import { minioObjectSource, type StoredObjectClient } from "@/lib/profile-project-image-storage";
import {
  parseRange,
  streamStoredObject,
  type StoredObjectSource,
} from "@/lib/stored-object-stream";

const BODY = new TextEncoder().encode("0123456789");

function memorySource(objects: Record<string, Uint8Array>, etag = "abc"): StoredObjectSource {
  return {
    async stat(key) {
      const bytes = objects[key];
      return bytes ? { size: bytes.byteLength, etag, contentType: "text/plain" } : null;
    },
    async stream(key, range) {
      const bytes = objects[key];
      if (!bytes) return null;
      const slice = range ? bytes.slice(range.start, range.end + 1) : bytes;
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(slice);
          controller.close();
        },
      });
    },
  };
}

const source = memorySource({ "a/b": BODY });
const get = (headers: Record<string, string> = {}, method = "GET") =>
  new Request("http://site.test/x", { method, headers });

describe("streamStoredObject", () => {
  it("serves the whole object with its etag, length and type", async () => {
    const res = await streamStoredObject("a/b", get(), { source });
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe('"abc"');
    expect(res.headers.get("content-length")).toBe("10");
    expect(res.headers.get("content-type")).toBe("text/plain");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await res.text()).toBe("0123456789");
  });

  it("answers 404 for a missing object, with the caller's headers", async () => {
    const res = await streamStoredObject("nope", get(), {
      source,
      headers: { "x-content-type-options": "nosniff" },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("answers 304 when If-None-Match names the etag, weak or listed", async () => {
    for (const tag of ['"abc"', 'W/"abc"', '"zzz", "abc"', "*"]) {
      const res = await streamStoredObject("a/b", get({ "if-none-match": tag }), { source });
      expect(res.status).toBe(304);
      expect(await res.text()).toBe("");
    }
    const miss = await streamStoredObject("a/b", get({ "if-none-match": '"zzz"' }), { source });
    expect(miss.status).toBe(200);
  });

  it("lets the caller's etag and type win over the object's", async () => {
    const opts = {
      source,
      contentType: "application/json",
      headers: { etag: '"sha"', "cache-control": "private, max-age=3600" },
    };
    const res = await streamStoredObject("a/b", get(), opts);
    expect(res.headers.get("etag")).toBe('"sha"');
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("private, max-age=3600");
    const cached = await streamStoredObject("a/b", get({ "if-none-match": '"sha"' }), opts);
    expect(cached.status).toBe(304);
  });

  it("answers HEAD with the length and no body", async () => {
    const res = await streamStoredObject("a/b", get({}, "HEAD"), { source });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("10");
    expect(res.body).toBeNull();
  });

  it("serves a range as 206", async () => {
    const res = await streamStoredObject("a/b", get({ range: "bytes=2-5" }), { source });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(res.headers.get("content-length")).toBe("4");
    expect(await res.text()).toBe("2345");

    const tail = await streamStoredObject("a/b", get({ range: "bytes=-3" }), { source });
    expect(await tail.text()).toBe("789");
    const open = await streamStoredObject("a/b", get({ range: "bytes=7-" }), { source });
    expect(open.headers.get("content-range")).toBe("bytes 7-9/10");
  });

  it("answers 416 for a range it can't satisfy", async () => {
    for (const range of ["bytes=10-", "bytes=5-2", "bytes=x-y", "bytes=-0"]) {
      const res = await streamStoredObject("a/b", get({ range }), { source });
      expect(res.status).toBe(416);
      expect(res.headers.get("content-range")).toBe("bytes */10");
    }
  });

  it("serves the whole object for several ranges or a stale If-Range", async () => {
    const several = await streamStoredObject("a/b", get({ range: "bytes=0-1,4-5" }), { source });
    expect(several.status).toBe(200);
    const stale = await streamStoredObject(
      "a/b",
      get({ range: "bytes=0-1", "if-range": '"old"' }),
      { source },
    );
    expect(stale.status).toBe(200);
    const fresh = await streamStoredObject(
      "a/b",
      get({ range: "bytes=0-1", "if-range": '"abc"' }),
      { source },
    );
    expect(fresh.status).toBe(206);
  });
});

describe("parseRange", () => {
  it("clamps an end past the object", () => {
    expect(parseRange("bytes=8-100", 10)).toEqual({ start: 8, end: 9 });
    expect(parseRange("bytes=-100", 10)).toEqual({ start: 0, end: 9 });
    expect(parseRange("items=0-1", 10)).toBeNull();
    expect(parseRange(null, 10)).toBeNull();
  });
});

describe("minioObjectSource", () => {
  const missing = () => Object.assign(new Error("gone"), { code: "NotFound" });
  const calls: string[] = [];
  const client: StoredObjectClient = {
    async statObject(_bucket, key) {
      if (key !== "a/b") throw missing();
      return { size: BODY.byteLength, etag: "e1", metaData: { "content-type": "image/png" } };
    },
    async getObject(_bucket, key) {
      calls.push(`get ${key}`);
      return Readable.from([Buffer.from(BODY)]);
    },
    async getPartialObject(_bucket, key, offset, length) {
      calls.push(`partial ${key} ${offset} ${length}`);
      return Readable.from([Buffer.from(BODY.slice(offset, offset + (length ?? BODY.length)))]);
    },
  };
  const minio = minioObjectSource({ client, bucket: "site" });

  it("reads ranges through getPartialObject and treats a missing object as null", async () => {
    const res = await streamStoredObject("a/b", get({ range: "bytes=3-4" }), { source: minio });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe("34");
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("etag")).toBe('"e1"');
    expect(calls).toEqual(["partial a/b 3 2"]);
    expect(await minio.stat("other")).toBeNull();
    const whole = await streamStoredObject("a/b", get(), { source: minio });
    expect(await whole.text()).toBe("0123456789");
  });
});
