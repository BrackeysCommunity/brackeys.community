// The site's engine route paths, shared by the routes and the scene CLI's
// hosted client. Free of runtime imports so scripts and services can import it.

import type { ReleaseChannel } from "./release-access";

export const AGENT_SYNC_TOKEN_PATH = "/api/engine/agent-sync-token";

/** A hosted game's page: `/games/<id>`. */
export const gamePagePath = (projectId: string) => `/games/${encodeURIComponent(projectId)}`;

/** Where the game plays: `/games/<id>/play`, or `/games/<id>/play/<channel or version>` pinned. */
export const gamePlayPath = (projectId: string, pinned?: string | number) =>
  pinned === undefined
    ? `${gamePagePath(projectId)}/play`
    : `${gamePagePath(projectId)}/play/${encodeURIComponent(String(pinned))}`;

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

/**
 * Live scene versions. `POST …/live` begins a scene upload and `GET` lists
 * the project's versions (one scene's with `scene`); the texts go up
 * through `engineReleaseFilePath`, like a release's.
 */
export const engineLivePath = (projectId: string, scene?: string) =>
  engineProjectPath(
    projectId,
    scene === undefined ? "/live" : `/live?scene=${encodeURIComponent(scene)}`,
  );

/** `POST …/live/commit` finishes a scene upload. */
export const engineLiveCommitPath = (projectId: string) =>
  engineProjectPath(projectId, "/live/commit");

const liveScenePath = (projectId: string, scene: string, rest: string) =>
  engineProjectPath(projectId, `/live/scenes/${encodeURIComponent(scene)}${rest}`);

/** `GET` what the Publish scene checks compare against on `channel`: its release and the scene's live version. */
export const engineLiveBasePath = (projectId: string, scene: string, channel: ReleaseChannel) =>
  liveScenePath(projectId, scene, `/base?channel=${channel}`);

/** `POST …/live/scenes/<scene>/<number>/promote`: point a channel at that version. */
export const engineLivePromotePath = (projectId: string, scene: string, number: number) =>
  liveScenePath(projectId, scene, `/${number}/promote`);

/** `POST …/live/scenes/<scene>/rollback` or `…/clear` ("Stop"): a channel's pointer back, or off. */
export const engineLiveMovePath = (projectId: string, scene: string, move: "rollback" | "clear") =>
  liveScenePath(projectId, scene, `/${move}`);

/** `GET` one channel's live moves as server-sent events. */
export const engineLiveStreamPath = (projectId: string, channel: ReleaseChannel) =>
  `/api/engine/live/${encodeURIComponent(projectId)}/stream?channel=${channel}`;

/** Matches the live stream path without its query: the encoded project id. */
export const LIVE_STREAM_PATH = /^\/api\/engine\/live\/([^/]+)\/stream$/;

/** Matches the live path: the encoded project id. */
export const LIVE_PATH = /^\/api\/engine\/projects\/([^/]+)\/live$/;
export const LIVE_COMMIT_PATH = /^\/api\/engine\/projects\/([^/]+)\/live\/commit$/;
/** The encoded project id and scene. */
export const LIVE_BASE_PATH = /^\/api\/engine\/projects\/([^/]+)\/live\/scenes\/([^/]+)\/base$/;
/** The encoded project id, the scene and the number. */
export const LIVE_PROMOTE_PATH =
  /^\/api\/engine\/projects\/([^/]+)\/live\/scenes\/([^/]+)\/(\d+)\/promote$/;
/** The encoded project id, the scene and the move. */
export const LIVE_MOVE_PATH =
  /^\/api\/engine\/projects\/([^/]+)\/live\/scenes\/([^/]+)\/(rollback|clear)$/;

/** `GET` every game's saves on the signed-in account. */
export const ENGINE_SAVES_PATH = "/api/engine/saves";

/** `GET` a game's saves, with its limits, its save menu's sentence and its save mode. */
export const engineProjectSavesPath = (projectId: string) =>
  `${ENGINE_SAVES_PATH}/${encodeURIComponent(projectId)}`;

/** `GET`, `PUT` or `DELETE` one slot's save. */
export const engineSavePath = (projectId: string, slot: string) =>
  `${engineProjectSavesPath(projectId)}/${encodeURIComponent(slot)}`;

export const SAVES_PATH = /^\/api\/engine\/saves$/;
/** The encoded project id. */
export const PROJECT_SAVES_PATH = /^\/api\/engine\/saves\/([^/]+)$/;
/** The encoded project id and slot. */
export const SAVE_SLOT_PATH = /^\/api\/engine\/saves\/([^/]+)\/([^/]+)$/;

/** The game room the editor opens a project in, as the game page and the scene CLI link it. */
export const EDITOR_ROOM = "dev";

/** The editor panels a link can open through the room's `?panel=`. */
export const EDITOR_LINK_PANELS = ["publish"] as const;
export type EditorLinkPanel = (typeof EDITOR_LINK_PANELS)[number];
export const isEditorLinkPanel = (value: unknown): value is EditorLinkPanel =>
  (EDITOR_LINK_PANELS as readonly unknown[]).includes(value);

/** The editor room's search for a project: `scene` opens that scene, `panel` that panel once it's there. */
export const editorSearch = (
  projectId: string,
  opts: { scene?: string; panel?: EditorLinkPanel } = {},
) => ({
  edit: 1 as const,
  project: projectId,
  ...(opts.scene === undefined ? {} : { scene: opts.scene }),
  ...(opts.panel === undefined ? {} : { panel: opts.panel }),
});

/** `/game/dev?edit=1&project=<id>[&scene=<scene>][&panel=<panel>]`. */
export const editorPath = (
  projectId: string,
  opts: { scene?: string; panel?: EditorLinkPanel } = {},
): string => {
  const query = Object.entries(editorSearch(projectId, opts)).map(([k, v]) => [k, String(v)]);
  return `/game/${EDITOR_ROOM}?${new URLSearchParams(query)}`;
};
