import { nanoid } from "nanoid";

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
  return `${PROFILE_PROJECT_IMAGE_PREFIX}/${userId}/${nanoid()}-${sanitizedFilename}`;
}

/** Team avatars live in their own key namespace, scoped by team id;
 *  write access is a membership check, not a key-prefix check. */
export const TEAM_AVATAR_IMAGE_PREFIX = "team-avatars";

export function buildTeamAvatarObjectKey(teamId: string, filename: string) {
  const sanitizedFilename = sanitizeProfileProjectImageFilename(filename);
  return `${TEAM_AVATAR_IMAGE_PREFIX}/${teamId}/${nanoid()}-${sanitizedFilename}`;
}

/**
 * A canonical project's cover lives in a **project-scoped** namespace, not
 * the uploader's.
 *
 * The prefix above is per-user, and account deletion removes every object
 * under it — correct for a placement's own image, wrong for a shared entity:
 * a project row referencing an uploader's key would have its cover blanked
 * on every page the day that person deleted their account. Write access here
 * is the project's editor check (`createdBy`, a linked contributor, or a
 * member of a claiming team), never a key-prefix check — same rule as team
 * avatars.
 */
export const PROJECT_IMAGE_PREFIX = "project-images";

export function buildProjectImageObjectKey(projectId: string, filename: string) {
  const sanitizedFilename = sanitizeProfileProjectImageFilename(filename);
  return `${PROJECT_IMAGE_PREFIX}/${projectId}/${nanoid()}-${sanitizedFilename}`;
}

/** Root path of the stable serving route (src/routes/images.$.ts). */
export const STORED_IMAGE_ROUTE_PREFIX = "/images/";

const SERVABLE_IMAGE_KEY_PREFIXES = [
  `${PROFILE_PROJECT_IMAGE_PREFIX}/`,
  `${TEAM_AVATAR_IMAGE_PREFIX}/`,
  `${PROJECT_IMAGE_PREFIX}/`,
] as const;

/**
 * Gate for the public serving route: only keys minted by our upload
 * handlers resolve, so nothing else in the private bucket is reachable.
 */
export function isServableImageKey(key: string) {
  return (
    SERVABLE_IMAGE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)) &&
    !key.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  );
}

export function isOwnedProfileProjectImageKey(userId: string, key: string) {
  return key.startsWith(`${PROFILE_PROJECT_IMAGE_PREFIX}/${userId}/`);
}

/** Whether a key belongs to this project's namespace — the guard for an
 * editor-supplied `imageKey`, so nobody can point a project at somebody
 * else's object. */
export function isProjectImageKey(projectId: string, key: string) {
  return key.startsWith(`${PROJECT_IMAGE_PREFIX}/${projectId}/`);
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
