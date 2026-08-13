import { Readable } from "node:stream";

import { Client } from "minio";

import { env } from "@/env";
import {
  buildProfileProjectImageObjectKey,
  isAllowedProfileProjectImageType,
  PROFILE_PROJECT_IMAGE_MAX_SIZE_BYTES,
  STORED_IMAGE_ROUTE_PREFIX,
  type UploadedProfileProjectImage,
} from "@/lib/profile-project-images";

export class ProfileProjectImageUploadError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ProfileProjectImageUploadError";
    this.status = status;
  }
}

let minioClient: Client | null = null;

function getMinioClient() {
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

  console.log(url);
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

/** Shared validate + put + presign for any image object this app stores. */
export async function uploadImageToStorage({
  file,
  objectKey,
}: {
  file: File;
  objectKey: string;
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

/**
 * Serve a stored object for the `/images/<key>` route. The immutable
 * cache-control on 200s is also enforced by the `/images/**` route rule in
 * vite.config.ts; it's set here too so dev and conditional responses agree.
 * Keys are validated by the route before this is called.
 */
export async function streamStoredImage(objectKey: string, request: Request): Promise<Response> {
  const bucket = env.MINIO_BUCKET;
  if (!bucket) {
    return new Response("Not Found", { status: 404 });
  }

  let stat;
  try {
    stat = await getMinioClient().statObject(bucket, objectKey);
  } catch {
    return new Response("Not Found", { status: 404 });
  }

  const headers = new Headers({
    "cache-control": "public, max-age=31536000, immutable",
  });
  const contentType = stat.metaData?.["content-type"];
  if (contentType) headers.set("content-type", contentType);
  const etag = stat.etag ? `"${stat.etag}"` : null;
  if (etag) headers.set("etag", etag);

  const ifNoneMatch = request.headers.get("if-none-match");
  if (etag && ifNoneMatch && ifNoneMatch.replace(/^W\//, "") === etag) {
    return new Response(null, { status: 304, headers });
  }

  if (request.method === "HEAD") {
    headers.set("content-length", String(stat.size));
    return new Response(null, { headers });
  }

  try {
    const objectStream = await getMinioClient().getObject(bucket, objectKey);
    headers.set("content-length", String(stat.size));
    return new Response(Readable.toWeb(objectStream) as unknown as BodyInit, { headers });
  } catch (error) {
    console.error("Failed to stream stored image", { objectKey, error });
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
