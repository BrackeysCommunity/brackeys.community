export const PROFILE_PROJECT_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const PROFILE_PROJECT_IMAGE_ACCEPTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

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
