import { hashForPut, type ContentStore, type Sha256 } from "@jams/engine/project";

import { env } from "@/env";
import { getMinioClient, isMissingObject } from "@/lib/profile-project-image-storage";
import { buildEngineAssetObjectKey } from "@/lib/stored-image-keys";

/** The bucket calls the store makes; the site's MinIO client has them. */
export type EngineObjectClient = {
  putObject(
    bucket: string,
    key: string,
    body: Buffer,
    size: number,
    meta: Record<string, string>,
  ): Promise<unknown>;
  statObject(bucket: string, key: string): Promise<unknown>;
  getObject(bucket: string, key: string): Promise<AsyncIterable<Uint8Array | string>>;
};

/** A project's hosted content store: the engine's `ContentStore`, plus the object key and type a blob is stored under. */
export type SiteContentStore = ContentStore & {
  put(bytes: Uint8Array, expect?: Sha256, opts?: { contentType?: string }): Promise<Sha256>;
  keyOf(hash: Sha256): string;
};

/**
 * Bytes by hash under `engine-assets/<project>/<sha256>`, on the bucket the
 * site's uploads use. `put` hashes before it writes, so a refused claim
 * (`hash-mismatch`) stores nothing, and the same bytes always land on the
 * same object. A quarantined image reads as missing.
 */
export function minioContentStore(
  projectId: string,
  opts: { client?: EngineObjectClient; bucket?: string } = {},
): SiteContentStore {
  const client = (): EngineObjectClient => opts.client ?? getMinioClient();
  const bucket = () => {
    const name = opts.bucket ?? env.MINIO_BUCKET;
    if (!name) throw new Error("MINIO_BUCKET is required for engine assets.");
    return name;
  };
  const keyOf = (hash: Sha256) => buildEngineAssetObjectKey(projectId, hash);

  return {
    keyOf,
    async has(hash) {
      try {
        await client().statObject(bucket(), keyOf(hash));
        return true;
      } catch (error) {
        if (isMissingObject(error)) return false;
        throw error;
      }
    },
    async get(hash) {
      let stream: AsyncIterable<Uint8Array | string>;
      try {
        stream = await client().getObject(bucket(), keyOf(hash));
      } catch (error) {
        if (isMissingObject(error)) return null;
        throw error;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      return new Uint8Array(Buffer.concat(chunks));
    },
    async put(bytes: Uint8Array, expect?: Sha256, putOpts: { contentType?: string } = {}) {
      const hash = await hashForPut(bytes, expect);
      const body = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      await client().putObject(bucket(), keyOf(hash), body, body.byteLength, {
        "Content-Type": putOpts.contentType ?? "application/octet-stream",
      });
      return hash;
    },
  };
}
