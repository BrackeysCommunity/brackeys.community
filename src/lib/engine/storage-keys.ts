// The object keys of hosted games, in the site's bucket. Import-free, so the
// services that copy it need nothing else. None of them is an image key:
// `/images/` never serves them.

/** A project's blobs: `engine-assets/<project>/<sha256>`. */
export const ENGINE_ASSETS_PREFIX = "engine-assets";
/** Release files that aren't the project's blobs, shared by every release listing them: `engine-releases/<project>/<sha256>`. */
export const ENGINE_RELEASES_PREFIX = "engine-releases";
/** One save each: `engine-saves/<userId>/<project>/<slot>`. */
export const ENGINE_SAVES_PREFIX = "engine-saves";

export const engineAssetKey = (projectId: string, sha256: string): string =>
  `${ENGINE_ASSETS_PREFIX}/${projectId}/${sha256}`;

export const engineReleaseObjectKey = (projectId: string, sha256: string): string =>
  `${ENGINE_RELEASES_PREFIX}/${projectId}/${sha256}`;

export const engineSaveKey = (userId: string, projectId: string, slot: string): string =>
  `${ENGINE_SAVES_PREFIX}/${userId}/${projectId}/${slot}`;

/** Every key of a project's blobs or release files starts with one of these. */
export const engineProjectPrefixes = (projectId: string): [string, string] => [
  `${ENGINE_ASSETS_PREFIX}/${projectId}/`,
  `${ENGINE_RELEASES_PREFIX}/${projectId}/`,
];

/** Every save a player keeps starts with this, so deleting an account finds them by prefix. */
export const engineSavesPrefixOf = (userId: string): string => `${ENGINE_SAVES_PREFIX}/${userId}/`;
