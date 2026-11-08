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
