import type { EngineObjectClient } from "../content-store";

type Stored = { body: Buffer; meta: Record<string, string> };

const missing = (code: string) => Object.assign(new Error(code), { code });

/** A bucket in memory, failing the way MinIO does for a missing object. */
export function fakeMinio() {
  const objects = new Map<string, Stored>();
  const at = (bucket: string, key: string) => `${bucket}/${key}`;
  const client: EngineObjectClient & { failNext?: Error } = {
    async putObject(bucket, key, body, _size, meta) {
      objects.set(at(bucket, key), { body: Buffer.from(body), meta });
      return { etag: "e" };
    },
    async statObject(bucket, key) {
      if (client.failNext) throw client.failNext;
      const object = objects.get(at(bucket, key));
      if (!object) throw missing("NotFound");
      return { size: object.body.byteLength, metaData: object.meta };
    },
    async getObject(bucket, key) {
      const object = objects.get(at(bucket, key));
      if (!object) throw missing("NoSuchKey");
      const half = Math.ceil(object.body.byteLength / 2);
      return (async function* () {
        yield object.body.subarray(0, half);
        yield object.body.subarray(half);
      })();
    },
  };
  return { client, objects };
}

export function isMissingObjectError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "NoSuchKey" || code === "NotFound";
}
