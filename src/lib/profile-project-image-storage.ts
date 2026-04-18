import { Client } from "minio";

import { env } from "@/env";
import {
  buildProfileProjectImageObjectKey,
  isAllowedProfileProjectImageType,
  PROFILE_PROJECT_IMAGE_MAX_SIZE_BYTES,
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

export function getProfileProjectImageUrl(objectKey: string | null | undefined) {
  if (!objectKey) {
    return null;
  }

  const bucket = env.MINIO_BUCKET;
  const endpoint = env.MINIO_ENDPOINT;
  if (!bucket || !endpoint) {
    return null;
  }

  const baseUrl = endpoint.includes("://") ? endpoint : `https://${endpoint}`;
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(`${bucket}/${objectKey}`, normalizedBaseUrl).toString();
}

export async function uploadProfileProjectImageToStorage({
  file,
  userId,
}: {
  file: File;
  userId: string;
}): Promise<UploadedProfileProjectImage> {
  if (!isAllowedProfileProjectImageType(file.type)) {
    throw new ProfileProjectImageUploadError("Unsupported image type. Use PNG, JPG, WEBP, or GIF.");
  }

  if (file.size <= 0 || file.size > PROFILE_PROJECT_IMAGE_MAX_SIZE_BYTES) {
    throw new ProfileProjectImageUploadError("Image must be smaller than 5 MB.");
  }

  const bucket = env.MINIO_BUCKET;
  if (!bucket) {
    throw new ProfileProjectImageUploadError(
      "MINIO_BUCKET is required for profile image uploads.",
      500,
    );
  }

  const objectKey = buildProfileProjectImageObjectKey(userId, file.name);
  const buffer = Buffer.from(await file.arrayBuffer());

  await getMinioClient().putObject(bucket, objectKey, buffer, buffer.byteLength, {
    "Content-Type": file.type,
  });

  const url = getProfileProjectImageUrl(objectKey);
  if (!url) {
    throw new ProfileProjectImageUploadError(
      "Profile image URL could not be resolved from MinIO configuration.",
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
