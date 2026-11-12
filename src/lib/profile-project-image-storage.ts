import { Readable } from "node:stream";

import { Client } from "minio";

import { env } from "@/env";
import type { ImageObjectStore } from "@/lib/image-quarantine";
import {
  isAllowedProfileProjectImageType,
  PROFILE_PROJECT_IMAGE_MAX_SIZE_BYTES,
  type UploadedProfileProjectImage,
} from "@/lib/image-upload-policy";
import { requestUploadScan } from "@/lib/media-scan";
import { bestEffort } from "@/lib/posthog-server";
import { buildProfileProjectImageObjectKey } from "@/lib/stored-image-keys";
import { STORED_IMAGE_ROUTE_PREFIX } from "@/lib/stored-image-urls";
import { streamStoredObject, type StoredObjectSource } from "@/lib/stored-object-stream";

export class ProfileProjectImageUploadError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ProfileProjectImageUploadError";
    this.status = status;
  }
}

let minioClient: Client | null = null;

export function getMinioClient() {
  if (minioClient) {
    return minioClient;
  }

  const endpoint = env.MINIO_ENDPOINT;
  const accessKey = env.MINIO_ACCESS_KEY;
  const secretKey = env.MINIO_SECRET_KEY;
  if (!endpoint || !accessKey || !secretKey) {
    throw new Error("MINIO_ENDPOINT, MINIO_ACCESS_KEY, and MINIO_SECRET_KEY are required.");
  }

  const url = new URL(endpoint.includes("://") ? endpoint : `https://${endpoint}`);

  minioClient = new Client({
    endPoint: url.hostname,
    port: url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
    useSSL: url.protocol === "https:",
    accessKey,
    secretKey,
  });

  return minioClient;
}

/**
 * Resolve a stored object key to a browser-loadable URL: the stable
 * `/images/<key>` proxy route (src/routes/images.$.ts). Keys are
 * nanoid-unique per upload, so the URL is immutable and cacheable end to
 * end — browser, Cloudflare edge, and `/cdn-cgi/image/` transforms — where
 * the presigned links this replaced rotated their signature on every read
 * and defeated all three. The bucket stays private; the route only serves
 * keys our upload handlers mint.
 */
export async function getProfileProjectImageUrl(objectKey: string | null | undefined) {
  if (!objectKey) return null;

  // Without MinIO config the serving route would have nothing to read;
  // returning null lets call sites fall back to their stored URL.
  if (!env.MINIO_BUCKET || !env.MINIO_ENDPOINT) return null;

  return `${STORED_IMAGE_ROUTE_PREFIX}${objectKey}`;
}

/**
 * Resolve many object keys at once. Skips empty/null keys and falls
 * back to `null` for any that fail to presign.
 */
export async function getProfileProjectImageUrls(
  objectKeys: readonly (string | null | undefined)[],
) {
  return Promise.all(objectKeys.map((key) => getProfileProjectImageUrl(key)));
}

/**
 * Shared validate + put + presign for any image object this app stores.
 * Every upload also mints its media-scan bookkeeping row and enqueues the
 * scan — the row is what makes the image due for the worker's hourly
 * reconciler even if the enqueue is lost, so it is best-effort but never
 * skipped on purpose.
 */
export async function uploadImageToStorage({
  file,
  objectKey,
  uploaderId,
}: {
  file: File;
  objectKey: string;
  uploaderId: string;
}): Promise<UploadedProfileProjectImage> {
  if (!isAllowedProfileProjectImageType(file.type)) {
    throw new ProfileProjectImageUploadError("Unsupported image type. Use PNG, JPG, WEBP, or GIF.");
  }

  if (file.size <= 0 || file.size > PROFILE_PROJECT_IMAGE_MAX_SIZE_BYTES) {
    throw new ProfileProjectImageUploadError("Image must be smaller than 5 MB.");
  }

  const bucket = env.MINIO_BUCKET;
  if (!bucket) {
    throw new ProfileProjectImageUploadError("MINIO_BUCKET is required for image uploads.", 500);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  await getMinioClient().putObject(bucket, objectKey, buffer, buffer.byteLength, {
    "Content-Type": file.type,
  });

  const url = await getProfileProjectImageUrl(objectKey);
  if (!url) {
    throw new ProfileProjectImageUploadError(
      "Image URL could not be resolved from MinIO configuration.",
      500,
    );
  }

  await bestEffort("media_scan.request", { object_key: objectKey }, () =>
    requestUploadScan(objectKey, uploaderId),
  );

  return {
    key: objectKey,
    url,
    filename: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
  };
}

export async function uploadProfileProjectImageToStorage({
  file,
  userId,
}: {
  file: File;
  userId: string;
}): Promise<UploadedProfileProjectImage> {
  return uploadImageToStorage({
    file,
    objectKey: buildProfileProjectImageObjectKey(userId, file.name),
    uploaderId: userId,
  });
}

/**
 * A team row's display avatar: an uploaded key presigns fresh at read
 * time (same as `serializeTeamProject`); the stored URL is the fallback
 * for external/legacy values.
 */
export async function resolveTeamAvatarUrl(team: {
  avatarKey: string | null;
  avatarUrl: string | null;
}): Promise<string | null> {
  const presigned = await getProfileProjectImageUrl(team.avatarKey);
  return presigned ?? team.avatarUrl;
}

/** Same resolution as the avatar: uploaded key first, stored URL fallback. */
export async function resolveTeamBannerUrl(team: {
  bannerKey: string | null;
  bannerUrl: string | null;
}): Promise<string | null> {
  const presigned = await getProfileProjectImageUrl(team.bannerKey);
  return presigned ?? team.bannerUrl;
}

/** The bucket calls streaming needs; the site's MinIO client has them. */
export type StoredObjectClient = {
  statObject(
    bucket: string,
    key: string,
  ): Promise<{ size: number; etag?: string; metaData?: Record<string, unknown> }>;
  getObject(bucket: string, key: string): Promise<Readable>;
  getPartialObject(bucket: string, key: string, offset: number, length?: number): Promise<Readable>;
};

/**
 * Objects in the site's bucket, for `streamStoredObject`. A missing object
 * (or no bucket configured) stats and streams as null.
 */
export function minioObjectSource(
  opts: { client?: StoredObjectClient; bucket?: string } = {},
): StoredObjectSource {
  const client = (): StoredObjectClient => opts.client ?? getMinioClient();
  const bucketName = () => opts.bucket ?? env.MINIO_BUCKET;
  return {
    async stat(key) {
      const bucket = bucketName();
      if (!bucket) return null;
      try {
        const stat = await client().statObject(bucket, key);
        const contentType = stat.metaData?.["content-type"];
        return {
          size: stat.size,
          ...(stat.etag ? { etag: stat.etag } : {}),
          ...(typeof contentType === "string" ? { contentType } : {}),
        };
      } catch (error) {
        if (isMissingObject(error)) return null;
        throw error;
      }
    },
    async stream(key, range) {
      const bucket = bucketName();
      if (!bucket) return null;
      try {
        const body = range
          ? await client().getPartialObject(bucket, key, range.start, range.end - range.start + 1)
          : await client().getObject(bucket, key);
        return Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>;
      } catch (error) {
        if (isMissingObject(error)) return null;
        throw error;
      }
    },
  };
}

/**
 * Serve a stored object for the `/images/<key>` route. The immutable
 * cache-control on 200s is also enforced by the `/images/**` route rule in
 * vite.config.ts; it's set here too so dev and conditional responses agree.
 * Keys are validated by the route before this is called.
 */
export async function streamStoredImage(
  objectKey: string,
  request: Request,
  opts: { cacheControl?: string } = {},
): Promise<Response> {
  try {
    return await streamStoredObject(objectKey, request, {
      source: minioObjectSource(),
      ...(opts.cacheControl ? { cacheControl: opts.cacheControl } : {}),
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

export async function removeProfileProjectImageFromStorage(objectKey: string | null | undefined) {
  if (!objectKey) {
    return;
  }

  const bucket = env.MINIO_BUCKET;
  if (!bucket) {
    return;
  }

  await getMinioClient().removeObject(bucket, objectKey);
}

export function isMissingObject(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "NoSuchKey" || code === "NotFound";
}

/**
 * The bucket operations quarantine needs (`image-quarantine.ts`), bound to
 * the app's MinIO client. A missing source is not an error on either side:
 * a retried move finds its work already done, and a purge of an object a
 * previous attempt already removed is a purge.
 */
export const storedImageStore: ImageObjectStore = {
  async move(from, to) {
    const bucket = env.MINIO_BUCKET;
    if (!bucket) return;
    const client = getMinioClient();
    try {
      await client.copyObject(bucket, to, `/${bucket}/${from}`);
    } catch (error) {
      if (isMissingObject(error)) return;
      throw error;
    }
    await client.removeObject(bucket, from);
  },
  async remove(key) {
    const bucket = env.MINIO_BUCKET;
    if (!bucket) return;
    try {
      await getMinioClient().removeObject(bucket, key);
    } catch (error) {
      if (!isMissingObject(error)) throw error;
    }
  },
};
