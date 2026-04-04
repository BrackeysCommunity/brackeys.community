export const PROFILE_PROJECT_IMAGE_PREFIX = "profile-projects";
export const PROFILE_PROJECT_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const PROFILE_PROJECT_IMAGE_ACCEPTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

const MIME_TYPE_FILE_EXTENSIONS: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface UploadedProfileProjectImage {
  key: string;
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export function isAllowedProfileProjectImageType(mimeType: string) {
  return PROFILE_PROJECT_IMAGE_ACCEPTED_MIME_TYPES.includes(
    mimeType as (typeof PROFILE_PROJECT_IMAGE_ACCEPTED_MIME_TYPES)[number],
  );
}

export function buildProfileProjectImageObjectKey(userId: string, filename: string) {
  const sanitizedFilename = sanitizeProfileProjectImageFilename(filename);
  return `${PROFILE_PROJECT_IMAGE_PREFIX}/${userId}/${crypto.randomUUID()}-${sanitizedFilename}`;
}

export function isOwnedProfileProjectImageKey(userId: string, key: string) {
  return key.startsWith(`${PROFILE_PROJECT_IMAGE_PREFIX}/${userId}/`);
}

function sanitizeProfileProjectImageFilename(filename: string) {
  const trimmedFilename = filename.trim();
  const extension =
    getFilenameExtension(trimmedFilename) ||
    MIME_TYPE_FILE_EXTENSIONS[getMimeTypeFromFilename(trimmedFilename)] ||
    "bin";
  const basename = trimmedFilename
    .replace(/\.[^./\\]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `${basename || "image"}.${extension}`;
}

function getFilenameExtension(filename: string) {
  const lastDotIndex = filename.lastIndexOf(".");
  if (lastDotIndex === -1 || lastDotIndex === filename.length - 1) {
    return "";
  }

  return filename.slice(lastDotIndex + 1).toLowerCase();
}

function getMimeTypeFromFilename(filename: string) {
  const extension = getFilenameExtension(filename);
  switch (extension) {
    case "gif":
      return "image/gif";
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    default:
      return "";
  }
}
