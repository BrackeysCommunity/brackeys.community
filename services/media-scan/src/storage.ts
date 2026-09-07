import { Client } from "minio";

import type { ImageObjectStore } from "../../../src/lib/image-quarantine.ts";
import { config } from "./config.ts";

/**
 * The uploads bucket, read directly — never through the app's `/images/`
 * route, which would put a request server and an edge cache between the
 * worker and the bytes it is judging. Null when the bucket isn't configured.
 */
function createClient(): { client: Client; bucket: string } | null {
  const { MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_BUCKET } = config;
  if (!MINIO_ENDPOINT || !MINIO_ACCESS_KEY || !MINIO_SECRET_KEY || !MINIO_BUCKET) return null;
  const url = new URL(
    MINIO_ENDPOINT.includes("://") ? MINIO_ENDPOINT : `https://${MINIO_ENDPOINT}`,
  );
  return {
    client: new Client({
      endPoint: url.hostname,
      port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
      useSSL: url.protocol === "https:",
      accessKey: MINIO_ACCESS_KEY,
      secretKey: MINIO_SECRET_KEY,
    }),
    bucket: MINIO_BUCKET,
  };
}

export const storage = createClient();

function isMissingObject(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "NoSuchKey" || code === "NotFound";
}

/** The object's bytes, or null when it is gone. */
export async function readObject(key: string): Promise<Uint8Array | null> {
  if (!storage) return null;
  let stream;
  try {
    stream = await storage.client.getObject(storage.bucket, key);
  } catch (error) {
    if (isMissingObject(error)) return null;
    throw error;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return new Uint8Array(Buffer.concat(chunks));
}

/** The quarantine mechanics' view of the bucket (image-quarantine.ts). */
export const objectStore: ImageObjectStore = {
  async move(from, to) {
    if (!storage) return;
    try {
      await storage.client.copyObject(storage.bucket, to, `/${storage.bucket}/${from}`);
    } catch (error) {
      if (isMissingObject(error)) return;
      throw error;
    }
    await storage.client.removeObject(storage.bucket, from);
  },
  async remove(key) {
    if (!storage) return;
    try {
      await storage.client.removeObject(storage.bucket, key);
    } catch (error) {
      if (!isMissingObject(error)) throw error;
    }
  },
};
