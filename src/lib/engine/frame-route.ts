import { isSha256, liveFiles, RELEASE_FILE, type ReleaseFile } from "@jams/engine/project";
import { and, eq, isNull } from "drizzle-orm";

import { db as appDb } from "@/db";
import {
  engineBlobs,
  engineProjects,
  engineReleaseFiles,
  engineReleaseObjects,
  engineReleases,
} from "@/db/schema";
import { siteOrigin as appSiteOrigin } from "@/env";
import type { EngineReleaseNotice } from "@/lib/image-quarantine";
import { streamStoredObject, type StoredObjectSource } from "@/lib/stored-object-stream";

import { onReleaseNotice, type FrameCacheNoticeDeps } from "./frame-cache-notice";
import { frameBase, frameCsp, playOrigin as appPlayOrigin } from "./frame-csp";
import { onPlayHost, playHost as playHostOf } from "./frame-route-rules";
import { verifyFrameToken } from "./frame-token";
import { engineGamesAllowed } from "./guard";
import { liveFileVisible } from "./live-state";
import type { ReleaseDb } from "./release-audit";
import { contentTypeFor, type ReleaseObjectStore } from "./release-storage";
import { ttlLru } from "./ttl-lru";

/** Which prefix a frame request came in on. */
export type FramePrefix = "frames" | "frames-private";

export type FrameRouteDeps = {
  store: ReleaseObjectStore;
  db?: Pick<ReleaseDb, "select">;
  now?: () => Date;
  /** Whether this deployment may host games; default `engineGamesAllowed`. */
  allowed?: () => boolean;
  /** `ENGINE_PLAY_ORIGIN` when set: the route then answers only on that host. */
  playHostOrigin?: string | null;
  /** The origin frame files are served from, for the CSP's sources; default `playOrigin()`. */
  playOrigin?: () => string;
  /** The only origin that may frame them; default the site's. */
  siteOrigin?: () => string;
  /** The sync service, which an online project's frame may reach; default `CANVAS_SYNC_URL`'s origin. */
  syncOrigin?: () => string | null;
};

type Visibility = "private" | "team" | "unlisted" | "public";

/** One file a release lists, as the frame route serves it. */
export type ReleaseFileEntry = {
  sha256: string;
  storageKey: string;
  contentType: string;
  bytes: number;
};

/** A release's state and every file it lists; `files` is empty once collected. */
export type LoadedRelease = {
  releaseId: string;
  projectId: string;
  version: number;
  visibility: Visibility;
  hidden: boolean;
  /** What the publishers are told: the release's reason, else the project's. */
  hiddenReason: string | null;
  collected: boolean;
  connectOrigins: readonly string[];
  online: boolean;
  /** Which scene versions the release's `live/` prefix serves; '' when it takes none. */
  liveCompatKey: string;
  files: ReadonlyMap<string, ReleaseFileEntry>;
};

/** What a frame request resolves to: the release's state and the file a path names. */
export type ResolvedRelease = Omit<LoadedRelease, "files"> & { file: ReleaseFileEntry | null };

const CACHE_MAX = 1_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const RELEASE_ID = /^[0-9a-f]{64}$/;
/** A frame token is base64url parts joined by dots; anything else can't verify and mustn't reach the CSP. */
const FRAME_TOKEN_CHARS = /^[A-Za-z0-9_.-]{1,1024}$/;

/**
 * Hide and unhide change a release's answer here at once, and other
 * processes hear of it through the release notice; one that misses the
 * notice sees it within the TTL.
 */
const releaseCache = ttlLru<string, LoadedRelease>({ max: CACHE_MAX, ttlMs: CACHE_TTL_MS });

/** Drops a release from this process's cache, after it's hidden, unhidden or collected. */
export function forgetRelease(releaseId: string): void {
  releaseCache.delete(releaseId);
}

/**
 * Drops every cached release of a project and its `live/` lookups, after
 * the project, or one of its scene versions, is hidden or unhidden.
 */
export function forgetProjectReleases(projectId: string): void {
  releaseCache.deleteWhere((release) => release.projectId === projectId);
  forgetLiveFiles(projectId);
}

/** What a `live/<sha256><ext>` path resolves to: served, removed (410) or unknown (404). */
type LiveLookup = { status: "ok"; storageKey: string } | { status: "hidden" | "none" };

const LIVE_CACHE_MAX = 10_000;

/**
 * Listed and hidden answers, by project, compat key and file; an unknown
 * hash isn't kept, so a version committed after a probe serves at once.
 */
const liveCache = ttlLru<string, { projectId: string; lookup: LiveLookup }>({
  max: LIVE_CACHE_MAX,
  ttlMs: CACHE_TTL_MS,
});

/** Drops a project's cached `live/` lookups, so a hidden version's files answer 410 at once. */
export function forgetLiveFiles(projectId: string): void {
  liveCache.deleteWhere((entry) => entry.projectId === projectId);
}

/** The hash, extension and served type a `live/…` path names; null for anything the prefix doesn't serve. */
export function parseLivePath(
  path: string,
): { sha256: string; ext: string; contentType: string } | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.indexOf(".");
  const sha256 = name.slice(0, dot);
  if (dot < 0 || !isSha256(sha256)) return null;
  const ext = name.slice(dot);
  const named = ext === ".json" ? liveFiles.doc(sha256) : liveFiles.blob(name, sha256);
  if (path !== named) return null;
  // The asset row's table, which has `.json` too: scene, prefab and version texts.
  const contentType = contentTypeFor(`assets/${sha256}${ext}`, "asset");
  return contentType ? { sha256, ext, contentType } : null;
}

async function readLiveFile(
  db: Pick<ReleaseDb, "select">,
  input: { projectId: string; sha256: string; ext: string; compatKey: string },
): Promise<LiveLookup> {
  const status = await liveFileVisible(db, input);
  if (status !== "ok") return { status };
  const match = (table: typeof engineReleaseObjects | typeof engineBlobs) =>
    and(eq(table.projectId, input.projectId), eq(table.sha256, input.sha256));
  const [[text], [blob]] = await Promise.all([
    db
      .select({ storageKey: engineReleaseObjects.storageKey })
      .from(engineReleaseObjects)
      .where(match(engineReleaseObjects))
      .limit(1),
    db
      .select({ storageKey: engineBlobs.storageKey })
      .from(engineBlobs)
      .where(match(engineBlobs))
      .limit(1),
  ]);
  // Texts are release objects and blobs the project's own, but a blob a release
  // upload brought in is a release object too.
  const [first, second] = input.ext === ".json" ? [text, blob] : [blob, text];
  const storageKey = first?.storageKey ?? second?.storageKey;
  return storageKey ? { status: "ok", storageKey } : { status: "none" };
}

/** Whether a release's `live/` prefix serves a file, through this process's cache. */
async function lookupLiveFile(
  db: Pick<ReleaseDb, "select">,
  input: { projectId: string; sha256: string; ext: string; compatKey: string },
  now: number,
): Promise<LiveLookup> {
  const key = `${input.projectId}/${input.compatKey}/${input.sha256}${input.ext}`;
  const cached = liveCache.get(key, now);
  if (cached) return cached.lookup;
  const lookup = await readLiveFile(db, input);
  if (lookup.status === "none") return lookup;
  liveCache.set(key, { projectId: input.projectId, lookup }, now);
  return lookup;
}

/** Drops what a release notice names from this process's cache. */
export function applyReleaseNotice(notice: EngineReleaseNotice): void {
  for (const releaseId of notice.releaseIds) forgetRelease(releaseId);
  for (const projectId of notice.projectIds) forgetProjectReleases(projectId);
}

let listening: Promise<() => void> | null = null;

/**
 * Starts this cache listening for release notices, once; the first release
 * a frame loads starts it, since an empty cache has nothing to drop.
 * Returns the unsubscribe.
 */
export function listenForReleaseNotices(deps: FrameCacheNoticeDeps = {}): Promise<() => void> {
  listening ??= onReleaseNotice(applyReleaseNotice, deps);
  return listening;
}

async function readRelease(
  db: Pick<ReleaseDb, "select">,
  releaseId: string,
): Promise<LoadedRelease | null> {
  const [row] = await db
    .select({
      projectId: engineReleases.projectId,
      version: engineReleases.version,
      collectedAt: engineReleases.collectedAt,
      hiddenAt: engineReleases.hiddenAt,
      hiddenReason: engineReleases.hiddenReason,
      projectHiddenAt: engineProjects.hiddenAt,
      projectHiddenReason: engineProjects.hiddenReason,
      liveCompatKey: engineReleases.liveCompatKey,
      visibility: engineProjects.visibility,
      connectOrigins: engineProjects.connectOrigins,
      online: engineProjects.online,
    })
    .from(engineReleases)
    .innerJoin(engineProjects, eq(engineProjects.projectId, engineReleases.projectId))
    .where(and(eq(engineReleases.id, releaseId), isNull(engineProjects.deletedAt)))
    .limit(1);
  if (!row) return null;

  const collected = row.collectedAt !== null;
  const files = new Map<string, ReleaseFileEntry>();
  if (!collected) {
    const rows = await db
      .select({
        path: engineReleaseFiles.path,
        sha256: engineReleaseFiles.sha256,
        bytes: engineReleaseFiles.bytes,
        role: engineReleaseFiles.role,
        source: engineReleaseFiles.source,
        objectKey: engineReleaseObjects.storageKey,
        blobKey: engineBlobs.storageKey,
      })
      .from(engineReleaseFiles)
      .leftJoin(
        engineReleaseObjects,
        and(
          eq(engineReleaseObjects.projectId, engineReleaseFiles.projectId),
          eq(engineReleaseObjects.sha256, engineReleaseFiles.sha256),
        ),
      )
      .leftJoin(
        engineBlobs,
        and(
          eq(engineBlobs.projectId, engineReleaseFiles.projectId),
          eq(engineBlobs.sha256, engineReleaseFiles.sha256),
        ),
      )
      .where(eq(engineReleaseFiles.releaseId, releaseId));
    for (const file of rows) {
      const storageKey = file.source === "blob" ? file.blobKey : file.objectKey;
      const contentType = contentTypeFor(file.path, file.role as ReleaseFile["role"]);
      if (!storageKey || !contentType) continue;
      files.set(file.path, { sha256: file.sha256, storageKey, contentType, bytes: file.bytes });
    }
  }

  return {
    releaseId,
    projectId: row.projectId,
    version: row.version,
    visibility: row.visibility as Visibility,
    hidden: row.hiddenAt !== null || row.projectHiddenAt !== null,
    hiddenReason: row.hiddenReason ?? row.projectHiddenReason,
    collected,
    connectOrigins: row.connectOrigins,
    online: row.online,
    liveCompatKey: row.liveCompatKey,
    files,
  };
}

/**
 * A release's `release.json`, the text its id hashes: kept on the release row
 * rather than as a stored file, and read only when a frame asks for it, so the
 * release cache holds no manifests.
 */
async function readManifest(
  db: Pick<ReleaseDb, "select">,
  releaseId: string,
): Promise<StoredObjectSource | null> {
  const [row] = await db
    .select({ manifest: engineReleases.manifest })
    .from(engineReleases)
    .where(eq(engineReleases.id, releaseId))
    .limit(1);
  if (row?.manifest == null) return null;
  const bytes = new TextEncoder().encode(row.manifest);
  return {
    stat: async () => ({ size: bytes.byteLength }),
    stream: async (_key, range) =>
      new Response(range ? bytes.slice(range.start, range.end + 1) : bytes).body,
  };
}

/** A release and every file it lists, through this process's cache; null for an unknown release or a deleted project. */
export async function loadRelease(
  releaseId: string,
  opts: { db?: Pick<ReleaseDb, "select">; now?: () => Date } = {},
): Promise<LoadedRelease | null> {
  if (!RELEASE_ID.test(releaseId)) return null;
  void listenForReleaseNotices();
  const now = (opts.now ?? (() => new Date()))().getTime();
  const cached = releaseCache.get(releaseId, now);
  if (cached) return cached;

  const release = await readRelease(opts.db ?? appDb, releaseId);
  if (!release) return null;
  releaseCache.set(releaseId, release, now);
  return release;
}

/** The release a frame URL names and the file at `path`; null for an unknown release. */
export async function resolveRelease(
  releaseId: string,
  path: string,
  opts: { db?: Pick<ReleaseDb, "select">; now?: () => Date } = {},
): Promise<ResolvedRelease | null> {
  const release = await loadRelease(releaseId, opts);
  if (!release) return null;
  const { files, ...state } = release;
  return { ...state, file: files.get(path) ?? null };
}

type FrameRequestPath = { releaseId: string; token: string | null; path: string };

const decodeSegment = (segment: string): string | null => {
  try {
    const decoded = decodeURIComponent(segment);
    return decoded.includes("/") || decoded.includes("\\") ? null : decoded;
  } catch {
    return null;
  }
};

/** The release, token and file a frame URL names; null for anything malformed. */
export function parseFramePath(pathname: string, prefix: FramePrefix): FrameRequestPath | null {
  const lead = `/${prefix}/`;
  if (!pathname.startsWith(lead)) return null;
  const segments = pathname.slice(lead.length).split("/").map(decodeSegment);
  if (segments.some((s) => s === null || s === "" || s === "." || s === "..")) return null;
  const parts = segments as string[];
  const releaseId = parts.shift();
  if (!releaseId || !RELEASE_ID.test(releaseId)) return null;
  const token = prefix === "frames-private" ? (parts.shift() ?? null) : null;
  if (prefix === "frames-private" && !(token && FRAME_TOKEN_CHARS.test(token))) return null;
  if (parts.length === 0) return null;
  return { releaseId, token, path: parts.join("/") };
}

const syncOriginFromEnv = (): string | null => {
  const url = process.env.CANVAS_SYNC_URL;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

const prefixOf = (pathname: string): FramePrefix =>
  pathname.startsWith("/frames-private/") ? "frames-private" : "frames";

const PUBLIC_CACHE = "public, max-age=31536000, immutable";
const PRIVATE_CACHE = "private, max-age=3600";

/**
 * The `/frames/…` and `/frames-private/…` handler; without `prefix` it reads
 * the prefix from the request's path. It gates on the deployment, the
 * release's state and visibility, and the private prefix's token, but not on
 * `engine-games-enabled`: that flag is per person, and a frame request carries
 * no person (it comes from an opaque origin with no cookies, and public files
 * are edge-cached for everyone), so checking the signed-out answer would shut
 * frames to the people the flag is on for. A frame URL names a release id
 * only the flag-gated play and embed pages and procedures hand out.
 * Every response carries the frame's CSP, so a file opened directly runs in
 * the same sandbox; a public or unlisted release's admits any ancestor, so
 * the embed page can frame it on other sites.
 */
export function createFrameRoute(
  deps: FrameRouteDeps,
): (request: Request, prefix?: FramePrefix) => Promise<Response> {
  const now = deps.now ?? (() => new Date());
  const allowed = deps.allowed ?? engineGamesAllowed;
  const origin = deps.playOrigin ?? appPlayOrigin;
  const site = deps.siteOrigin ?? appSiteOrigin;
  const sync = deps.syncOrigin ?? syncOriginFromEnv;
  const playHost =
    deps.playHostOrigin === undefined ? playHostOf() : playHostOf(deps.playHostOrigin);

  return async (request, given) => {
    const url = new URL(request.url);
    const prefix = given ?? prefixOf(url.pathname);
    const parsed = parseFramePath(url.pathname, prefix);

    const base = parsed
      ? frameBase(parsed.releaseId, parsed.token ?? undefined, origin())
      : `${origin()}/${prefix}/`;
    const headers = (release?: LoadedRelease): Headers =>
      new Headers({
        "content-security-policy": frameCsp({
          base,
          siteOrigin: site(),
          connect: release?.connectOrigins ?? [],
          syncOrigin: release?.online ? sync() : null,
          embeddable: prefix === "frames",
        }),
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "access-control-allow-origin": "*",
        "cross-origin-resource-policy": "cross-origin",
      });
    const refuse = (status: 403 | 404 | 410, body: string, release?: LoadedRelease): Response => {
      const h = headers(release);
      h.set("content-type", "text/plain; charset=utf-8");
      h.set("cache-control", "no-store");
      return new Response(request.method === "HEAD" ? null : body, { status, headers: h });
    };
    const notFound = () => refuse(404, "Not Found");

    if (!allowed()) return notFound();
    if (playHost !== null && !onPlayHost(url, playHost)) return notFound();
    if (!parsed) return notFound();

    const release = await loadRelease(parsed.releaseId, {
      ...(deps.db ? { db: deps.db } : {}),
      now,
    });
    if (!release) return notFound();

    const privateRelease = release.visibility === "private" || release.visibility === "team";
    if (prefix === "frames" && privateRelease) return notFound();
    if (prefix === "frames-private") {
      if (!parsed.token || !(await verifyFrameToken(parsed.token, parsed.releaseId, now()))) {
        return refuse(403, "Forbidden");
      }
    }
    if (release.collected) return refuse(410, "This version of the game was removed");
    if (release.hidden) return refuse(410, "This version of the game isn't available");

    const cacheControl = prefix === "frames" ? PUBLIC_CACHE : PRIVATE_CACHE;
    if (parsed.path === RELEASE_FILE) {
      const manifest = await readManifest(deps.db ?? appDb, parsed.releaseId);
      if (!manifest) return notFound();
      const manifestHeaders = headers(release);
      manifestHeaders.set("etag", `"${parsed.releaseId}"`);
      manifestHeaders.set("cache-control", cacheControl);
      return streamStoredObject(RELEASE_FILE, request, {
        source: manifest,
        contentType: "application/json",
        headers: manifestHeaders,
      });
    }

    const serve = async (storageKey: string, sha256: string, contentType: string) => {
      const fileHeaders = headers(release);
      fileHeaders.set("etag", `"${sha256}"`);
      fileHeaders.set("cache-control", cacheControl);
      const response = await streamStoredObject(storageKey, request, {
        source: deps.store,
        contentType,
        headers: fileHeaders,
      });
      return response.status === 404 ? refuse(404, "Not Found", release) : response;
    };

    // A scene version's file, served beside the release it fits.
    const live = parseLivePath(parsed.path);
    if (live) {
      if (release.liveCompatKey === "") return refuse(404, "Not Found", release);
      const lookup = await lookupLiveFile(
        deps.db ?? appDb,
        {
          projectId: release.projectId,
          sha256: live.sha256,
          ext: live.ext,
          compatKey: release.liveCompatKey,
        },
        now().getTime(),
      );
      if (lookup.status !== "ok") {
        return lookup.status === "hidden"
          ? refuse(410, "This level was removed", release)
          : refuse(404, "Not Found", release);
      }
      return serve(lookup.storageKey, live.sha256, live.contentType);
    }

    const file = release.files.get(parsed.path);
    if (!file) return notFound();
    return serve(file.storageKey, file.sha256, file.contentType);
  };
}
