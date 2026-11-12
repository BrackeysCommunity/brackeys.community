import { Client } from "minio";

/**
 * What the collector does to the site's bucket: list a prefix and remove
 * keys. A key that is already gone is not an error, so a run that stopped
 * between an object and its row finishes the row next time.
 */
export interface CollectorObjectStore {
  remove(key: string): Promise<void>;
  /** Every key under `prefix`. */
  list(prefix: string): Promise<string[]>;
}

export interface MinioSettings {
  MINIO_ENDPOINT?: string;
  MINIO_ACCESS_KEY?: string;
  MINIO_SECRET_KEY?: string;
  MINIO_BUCKET?: string;
}

function isMissingObject(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "NoSuchKey" || code === "NotFound";
}

/** The uploads bucket the web app writes, read directly; null when it isn't configured. */
export function minioObjectStore(settings: MinioSettings): CollectorObjectStore | null {
  const { MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_BUCKET } = settings;
  if (!MINIO_ENDPOINT || !MINIO_ACCESS_KEY || !MINIO_SECRET_KEY || !MINIO_BUCKET) return null;
  const url = new URL(
    MINIO_ENDPOINT.includes("://") ? MINIO_ENDPOINT : `https://${MINIO_ENDPOINT}`,
  );
  const client = new Client({
    endPoint: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
    useSSL: url.protocol === "https:",
    accessKey: MINIO_ACCESS_KEY,
    secretKey: MINIO_SECRET_KEY,
  });
  const bucket = MINIO_BUCKET;
  return {
    async remove(key) {
      try {
        await client.removeObject(bucket, key);
      } catch (error) {
        if (!isMissingObject(error)) throw error;
      }
    },
    async list(prefix) {
      const keys: string[] = [];
      for await (const item of client.listObjectsV2(bucket, prefix, true)) {
        if (item.name) keys.push(item.name);
      }
      return keys;
    },
  };
}

/** A bucket in memory, for tests. */
export class MemoryObjectStore implements CollectorObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  removed: string[] = [];

  put(key: string, bytes: Uint8Array = new Uint8Array([1])): void {
    this.objects.set(key, bytes);
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }

  async remove(key: string): Promise<void> {
    if (this.objects.delete(key)) this.removed.push(key);
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
  }
}
