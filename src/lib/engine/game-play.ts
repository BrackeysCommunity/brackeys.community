import { and, eq, isNull } from "drizzle-orm";

import { db as siteDb } from "@/db";
import {
  engineProjects,
  engineReleaseChannels,
  engineReleaseJamLinks,
  engineReleases,
  projects,
} from "@/db/schema";

import { frameBase } from "./frame-csp";
import { resolveRelease } from "./frame-route";
import { mintFrameToken } from "./frame-token";
import type { LiveSnapshot } from "./live-state";
import { channelLive } from "./live-versions";
import {
  canPlay,
  roleOf,
  type GameVisibility,
  type PlayRefusal,
  type Viewer,
} from "./release-access";
import type { ReleaseDb } from "./release-audit";
import type { ReleaseChannel } from "./release-channels";
import { ttlLru } from "./ttl-lru";

/** What the play page needs: the frame URL, the release, where saves go and what the frame may reach. */
export type PlayPayload = {
  projectId: string;
  title: string;
  version: number;
  channel: "production" | "preview" | null;
  release: { id: string; gameId: string; engineVersion: string; createdAt: string };
  frameUrl: string;
  visibility: GameVisibility;
  saveMode: "site" | "own" | "none";
  connectOrigins: string[];
  online: boolean;
  viewer: { signedIn: boolean };
  /**
   * The channel's live scenes over its release, for `latest` and `preview`;
   * null for a version number, which always plays exactly that release.
   */
  live: LiveSnapshot | null;
};

export type PlayResolution = { ok: true; play: PlayPayload } | { ok: false; reason: PlayRefusal };

export type PlayDeps = {
  db?: ReleaseDb;
  now?: () => Date;
  /** Where frames are served from; default `playOrigin()`. */
  playOrigin?: string;
};

/** The file the frame opens; `host=jams` tells the shell to connect to the play page. */
const FRAME_ENTRY = "index.html";
const FRAME_QUERY = "?host=jams";
const VERSION_NUMBER = /^[1-9]\d{0,8}$/;

const refused = (reason: PlayRefusal): PlayResolution => ({ ok: false, reason });

/** The play page's moving version names: `latest` plays production, `preview` plays preview. */
const PLAY_VERSIONS = { production: "latest", preview: "preview" } as const;

/** The play page's version name for `channel`. */
export const playVersionOf = (channel: ReleaseChannel): "latest" | "preview" =>
  PLAY_VERSIONS[channel];

/** The channel a play version name follows, or null for a version number or anything else. */
export function channelOfPlayVersion(version: string): ReleaseChannel | null {
  if (version === PLAY_VERSIONS.production) return "production";
  if (version === PLAY_VERSIONS.preview) return "preview";
  return null;
}

const isPrivate = (visibility: string) => visibility === "private" || visibility === "team";

async function channelPointer(
  db: Pick<ReleaseDb, "select">,
  projectId: string,
  channel: ReleaseChannel,
): Promise<{ releaseId: string; rev: number } | null> {
  const [row] = await db
    .select({ releaseId: engineReleaseChannels.releaseId, rev: engineReleaseChannels.liveRev })
    .from(engineReleaseChannels)
    .where(
      and(
        eq(engineReleaseChannels.projectId, projectId),
        eq(engineReleaseChannels.channel, channel),
      ),
    )
    .limit(1);
  return row ?? null;
}

const LIVE_CACHE_MAX = 1_000;
const LIVE_CACHE_TTL_MS = 5_000;

/**
 * Channel snapshots by project, channel, rev and release, shared by every
 * caller in this process: a burst of pages after a move loads the pointers
 * once. A pending load is kept too, so concurrent misses share it.
 */
const liveCache = ttlLru<string, Promise<LiveSnapshot | null>>({
  max: LIVE_CACHE_MAX,
  ttlMs: LIVE_CACHE_TTL_MS,
});

/** Empties this process's live snapshot cache. */
export function forgetLiveSnapshots(): void {
  liveCache.clear();
}

/** The live scenes `channel` plays over `releaseId` at `rev`, through this process's cache. */
function channelSnapshot(
  db: ReleaseDb,
  input: { projectId: string; channel: ReleaseChannel; releaseId: string; rev: number },
  now: number,
): Promise<LiveSnapshot | null> {
  const key = `${input.projectId}/${input.channel}/${input.rev}/${input.releaseId}`;
  const cached = liveCache.get(key, now);
  if (cached) return cached;
  const snapshot = channelLive(db, input.projectId, input.channel).then((live) => {
    const current = live?.snapshot.release === input.releaseId && live.snapshot.rev === input.rev;
    // A move between the two reads: answer with what's there now, but don't file it under the old rev.
    if (!current) liveCache.delete(key);
    return live?.snapshot ?? null;
  });
  liveCache.set(key, snapshot, now);
  snapshot.catch(() => liveCache.delete(key));
  return snapshot;
}

const releaseColumns = {
  id: engineReleases.id,
  version: engineReleases.version,
  gameId: engineReleases.gameId,
  engineVersion: engineReleases.engineVersion,
  createdAt: engineReleases.createdAt,
  firstPromotedAt: engineReleases.firstPromotedAt,
  collectedAt: engineReleases.collectedAt,
  hiddenAt: engineReleases.hiddenAt,
};

/**
 * Resolves `latest` (production's pointer), `preview` (preview's pointer,
 * for the people who make the game) or a version number for this viewer.
 * Who may play it is `canPlay`'s answer; the frame route's view of the
 * release (hidden, collected, its files) is `resolveRelease`'s, so the page
 * never frames what the frame would refuse. A refusal carries its reason,
 * never a URL.
 *
 * The live state always names the payload's release, so the page follows
 * its channel. A channel that moves between the pointer read and the live
 * read is resolved once more; one that moves again gets an empty state at
 * rev 0 over the payload's release, so the page's first event or poll sees
 * the move and offers the reload.
 */
export async function resolvePlay(
  input: { projectId: string; version: string; viewer: Viewer },
  deps: PlayDeps = {},
): Promise<PlayResolution> {
  const first = await resolveOnce(input, deps);
  if (!movedMidRead(first)) return first;
  const again = await resolveOnce(input, deps);
  if (!movedMidRead(again)) return again;
  const { play } = again;
  return {
    ok: true,
    play: {
      ...play,
      live: {
        channel: play.live.channel,
        rev: 0,
        release: play.release.id,
        scenes: [],
        removed: [],
      },
    },
  };
}

/** The play a channel's moving name resolves to: `latest` for production, `preview` for preview. */
export const resolveChannelPlay = (
  input: { projectId: string; channel: ReleaseChannel; viewer: Viewer },
  deps: PlayDeps = {},
): Promise<PlayResolution> =>
  resolvePlay(
    { projectId: input.projectId, version: playVersionOf(input.channel), viewer: input.viewer },
    deps,
  );

const movedMidRead = (
  resolved: PlayResolution,
): resolved is { ok: true; play: PlayPayload & { live: LiveSnapshot } } =>
  resolved.ok &&
  resolved.play.live !== null &&
  resolved.play.live.release !== resolved.play.release.id;

async function resolveOnce(
  input: { projectId: string; version: string; viewer: Viewer },
  deps: PlayDeps,
): Promise<PlayResolution> {
  const db = deps.db ?? (siteDb as unknown as ReleaseDb);
  const now = deps.now ?? (() => new Date());
  const { projectId, version, viewer } = input;

  const [project] = await db
    .select({
      name: engineProjects.name,
      teamId: engineProjects.teamId,
      visibility: engineProjects.visibility,
      hiddenAt: engineProjects.hiddenAt,
      saveMode: engineProjects.saveMode,
      connectOrigins: engineProjects.connectOrigins,
      online: engineProjects.online,
      showcaseTitle: projects.title,
    })
    .from(engineProjects)
    .leftJoin(projects, eq(projects.id, engineProjects.showcaseProjectId))
    .where(and(eq(engineProjects.projectId, projectId), isNull(engineProjects.deletedAt)))
    .limit(1);
  if (!project) return refused("not-found");
  const visibility = project.visibility as GameVisibility;
  const role = roleOf(viewer, project);

  let channel: ReleaseChannel | null = null;
  let pointer: { releaseId: string; rev: number } | null = null;
  let releaseFilter;
  const moving = channelOfPlayVersion(version);
  if (moving !== null) {
    channel = moving;
    if (channel === "preview" && role === "player") return refused("not-found");
    pointer = await channelPointer(db, projectId, channel);
    if (pointer === null) return refused("not-found");
    releaseFilter = eq(engineReleases.id, pointer.releaseId);
  } else if (VERSION_NUMBER.test(version)) {
    releaseFilter = eq(engineReleases.version, Number(version));
  } else {
    return refused("not-found");
  }

  const [release] = await db
    .select(releaseColumns)
    .from(engineReleases)
    .where(and(eq(engineReleases.projectId, projectId), releaseFilter))
    .limit(1);
  if (!release) return refused("not-found");

  const [pin] = await db
    .select({ jamId: engineReleaseJamLinks.jamId })
    .from(engineReleaseJamLinks)
    .where(eq(engineReleaseJamLinks.releaseId, release.id))
    .limit(1);
  const audience = canPlay(
    viewer,
    { visibility, teamId: project.teamId, hiddenAt: project.hiddenAt },
    { ...release, jamPinned: pin !== undefined },
  );
  if (!audience.ok) return refused(audience.reason);

  const framed = await resolveRelease(release.id, FRAME_ENTRY, { db, now });
  if (!framed) return refused("not-found");
  if (framed.hidden) return refused("hidden");
  if (framed.collected) return refused("collected");
  if (!framed.file) return refused("not-found");

  if (channel === null) {
    const [production, preview] = await Promise.all([
      channelPointer(db, projectId, "production"),
      channelPointer(db, projectId, "preview"),
    ]);
    channel =
      production?.releaseId === release.id
        ? "production"
        : preview?.releaseId === release.id
          ? "preview"
          : null;
  }

  // A cached frame-route view can trail a visibility change by a few minutes; the private prefix
  // serves either way, so a release private in either view gets a token.
  let token: string | undefined;
  if (isPrivate(visibility) || isPrivate(framed.visibility)) {
    if (viewer.userId === null) return refused("forbidden");
    const minted = await mintFrameToken({
      releaseId: release.id,
      userId: viewer.userId,
      now: now(),
    });
    if (minted === null)
      throw new Error(
        "ENGINE_FRAME_SECRET isn't set, so private and team releases can't be framed.",
      );
    token = minted;
  }

  // Only the moving names take live scenes; a number is a permalink to exactly that release.
  const live =
    pointer && channel
      ? await channelSnapshot(
          db,
          { projectId, channel, releaseId: release.id, rev: pointer.rev },
          now().getTime(),
        )
      : null;

  return {
    ok: true,
    play: {
      projectId,
      title: project.showcaseTitle ?? project.name,
      version: release.version,
      channel,
      release: {
        id: release.id,
        gameId: release.gameId,
        engineVersion: release.engineVersion,
        createdAt: release.createdAt.toISOString(),
      },
      frameUrl: `${frameBase(release.id, token, deps.playOrigin)}${FRAME_ENTRY}${FRAME_QUERY}`,
      visibility,
      saveMode: project.saveMode as PlayPayload["saveMode"],
      connectOrigins: [...project.connectOrigins],
      online: project.online,
      viewer: { signedIn: viewer.userId !== null },
      live,
    },
  };
}
