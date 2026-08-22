import { nanoid } from "nanoid";

export const PROFILE_PROJECT_IMAGE_PREFIX = "profile-projects";

export function buildProfileProjectImageObjectKey(userId: string, filename: string) {
  return `${PROFILE_PROJECT_IMAGE_PREFIX}/${userId}/${nanoid()}-${sanitizeImageFilename(filename)}`;
}

export function isOwnedProfileProjectImageKey(userId: string, key: string) {
  return key.startsWith(`${PROFILE_PROJECT_IMAGE_PREFIX}/${userId}/`);
}

/** Team avatars live in their own key namespace, scoped by team id;
 *  write access is a membership check, not a key-prefix check. */
export const TEAM_AVATAR_IMAGE_PREFIX = "team-avatars";

export function buildTeamAvatarObjectKey(teamId: string, filename: string) {
  return `${TEAM_AVATAR_IMAGE_PREFIX}/${teamId}/${nanoid()}-${sanitizeImageFilename(filename)}`;
}

/** Team banners: same ownership rules as avatars, separate namespace so
 *  the two can be replaced/cleaned independently. */
export const TEAM_BANNER_IMAGE_PREFIX = "team-banners";

export function buildTeamBannerObjectKey(teamId: string, filename: string) {
  return `${TEAM_BANNER_IMAGE_PREFIX}/${teamId}/${nanoid()}-${sanitizeImageFilename(filename)}`;
}

/**
 * A canonical project's cover lives in a **project-scoped** namespace, not
 * the uploader's.
 *
 * The profile-project prefix is per-user, and account deletion removes every
 * object under it — correct for a placement's own image, wrong for a shared
 * entity: a project row referencing an uploader's key would have its cover
 * blanked on every page the day that person deleted their account. Write
 * access here is the project's editor check (`createdBy`, a linked
 * contributor, or a member of a claiming team), never a key-prefix check —
 * same rule as team avatars.
 */
export const PROJECT_IMAGE_PREFIX = "project-images";

export function buildProjectImageObjectKey(projectId: string, filename: string) {
  return `${PROJECT_IMAGE_PREFIX}/${projectId}/${nanoid()}-${sanitizeImageFilename(filename)}`;
}

/** Whether a key belongs to this project's namespace — the guard for an
 * editor-supplied `imageKey`, so nobody can point a project at somebody
 * else's object. */
export function isProjectImageKey(projectId: string, key: string) {
  return key.startsWith(`${PROJECT_IMAGE_PREFIX}/${projectId}/`);
}

/**
 * Collab post images are **post-scoped**, not uploader-scoped, for the same
 * reason as project covers: the post outlives nothing about the uploader's
 * account, and its images should be deletable with the post. Write access is
 * the post-author check in the upload handler and `addPostImage`.
 */
export const COLLAB_POST_IMAGE_PREFIX = "collab-post-images";

export function buildCollabPostImageObjectKey(postId: number, filename: string) {
  return `${COLLAB_POST_IMAGE_PREFIX}/${postId}/${nanoid()}-${sanitizeImageFilename(filename)}`;
}

export function isCollabPostImageKey(postId: number, key: string) {
  return key.startsWith(`${COLLAB_POST_IMAGE_PREFIX}/${postId}/`);
}

/**
 * Team showcase (team_projects) covers are **team-scoped**: any member can
 * add showcase rows, so the write check is membership, and the objects can
 * be swept when the row or the team goes away. Imported placements that
 * share an object with a source profile project keep their user-scoped key
 * and are exempt from that sweep.
 */
export const TEAM_PROJECT_IMAGE_PREFIX = "team-projects";

export function buildTeamProjectImageObjectKey(teamId: string, filename: string) {
  return `${TEAM_PROJECT_IMAGE_PREFIX}/${teamId}/${nanoid()}-${sanitizeImageFilename(filename)}`;
}

export function isTeamProjectImageKey(teamId: string, key: string) {
  return key.startsWith(`${TEAM_PROJECT_IMAGE_PREFIX}/${teamId}/`);
}

const SERVABLE_IMAGE_KEY_PREFIXES = [
  `${PROFILE_PROJECT_IMAGE_PREFIX}/`,
  `${TEAM_AVATAR_IMAGE_PREFIX}/`,
  `${TEAM_BANNER_IMAGE_PREFIX}/`,
  `${PROJECT_IMAGE_PREFIX}/`,
  `${COLLAB_POST_IMAGE_PREFIX}/`,
  `${TEAM_PROJECT_IMAGE_PREFIX}/`,
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

const MIME_TYPE_FILE_EXTENSIONS: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function sanitizeImageFilename(filename: string) {
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
