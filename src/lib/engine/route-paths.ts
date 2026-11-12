// The site's engine route paths, shared by the routes and the scene CLI's
// hosted client. Dependency-free so scripts and services can import it.

export const AGENT_SYNC_TOKEN_PATH = "/api/engine/agent-sync-token";

/** `/api/engine/projects/<id><rest>`. */
export const engineProjectPath = (projectId: string, rest = "") =>
  `/api/engine/projects/${encodeURIComponent(projectId)}${rest}`;

/** `…/blobs` (upload) or `…/blobs/<hash>` (read). */
export const engineBlobPath = (projectId: string, hash?: string) =>
  engineProjectPath(projectId, hash ? `/blobs/${hash}` : "/blobs");

export const engineBundlePath = (projectId: string) => engineProjectPath(projectId, "/bundle");

/** Matches a blob path: the encoded project id, and the hash when it names one. */
export const BLOBS_PATH = /^\/api\/engine\/projects\/([^/]+)\/blobs(?:\/([^/]+))?$/;
export const BUNDLE_PATH = /^\/api\/engine\/projects\/([^/]+)\/bundle$/;

/** `POST …/releases` begins an upload; `GET` lists the project's releases. */
export const engineReleasesPath = (projectId: string) => engineProjectPath(projectId, "/releases");

/** `POST …/releases/commit` finishes an upload. */
export const engineReleaseCommitPath = (projectId: string) =>
  engineProjectPath(projectId, "/releases/commit");

/** `POST …/releases/<version>/promote` or `…/rollback`. */
export const engineReleaseMovePath = (
  projectId: string,
  version: number,
  move: "promote" | "rollback",
) => engineProjectPath(projectId, `/releases/${version}/${move}`);

/** `POST …/releases/rollback`: back to the channel's previous release. */
export const engineReleaseRollbackPath = (projectId: string) =>
  engineProjectPath(projectId, "/releases/rollback");

/** `PUT` one file of an upload, by its hash. */
export const engineReleaseFilePath = (uploadId: string, sha256: string) =>
  `/api/engine/releases/uploads/${encodeURIComponent(uploadId)}/files/${sha256}`;

/** `GET` a release as the itch.io zip, by release id. */
export const engineReleaseZipPath = (releaseId: string) => `/api/engine/releases/${releaseId}/zip`;

/** Matches the releases path: the encoded project id. */
export const RELEASES_PATH = /^\/api\/engine\/projects\/([^/]+)\/releases$/;
export const RELEASE_COMMIT_PATH = /^\/api\/engine\/projects\/([^/]+)\/releases\/commit$/;
/** The encoded project id, the version and the move. */
export const RELEASE_MOVE_PATH =
  /^\/api\/engine\/projects\/([^/]+)\/releases\/(\d+)\/(promote|rollback)$/;
export const RELEASE_ROLLBACK_PATH = /^\/api\/engine\/projects\/([^/]+)\/releases\/rollback$/;
/** The encoded upload id and the hash. */
export const RELEASE_FILE_PATH = /^\/api\/engine\/releases\/uploads\/([^/]+)\/files\/([^/]+)$/;
/** The release id. */
export const RELEASE_ZIP_PATH = /^\/api\/engine\/releases\/([^/]+)\/zip$/;
