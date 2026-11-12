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
import {
  canPlay,
  roleOf,
  type GameVisibility,
  type PlayRefusal,
  type Viewer,
} from "./release-access";
import type { ReleaseDb } from "./release-audit";
import type { ReleaseChannel } from "./release-channels";

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
};

export type PlayResolution = { ok: true; play: PlayPayload } | { ok: false; reason: PlayRefusal };

export type PlayDeps = {
  db?: Pick<ReleaseDb, "select">;
  now?: () => Date;
  /** Where frames are served from; default `playOrigin()`. */
  playOrigin?: string;
};

/** The file the frame opens; `host=jams` tells the shell to connect to the play page. */
const FRAME_ENTRY = "index.html";
const FRAME_QUERY = "?host=jams";
const VERSION_NUMBER = /^[1-9]\d{0,8}$/;

const refused = (reason: PlayRefusal): PlayResolution => ({ ok: false, reason });

const isPrivate = (visibility: string) => visibility === "private" || visibility === "team";

async function channelPointer(
  db: Pick<ReleaseDb, "select">,
  projectId: string,
  channel: ReleaseChannel,
): Promise<string | null> {
  const [row] = await db
    .select({ releaseId: engineReleaseChannels.releaseId })
    .from(engineReleaseChannels)
    .where(
      and(
        eq(engineReleaseChannels.projectId, projectId),
        eq(engineReleaseChannels.channel, channel),
      ),
    )
    .limit(1);
  return row?.releaseId ?? null;
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
 */
export async function resolvePlay(
  input: { projectId: string; version: string; viewer: Viewer },
  deps: PlayDeps = {},
): Promise<PlayResolution> {
  const db = deps.db ?? (siteDb as unknown as Pick<ReleaseDb, "select">);
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
  let releaseFilter;
  if (version === "latest" || version === "preview") {
    channel = version === "latest" ? "production" : "preview";
    if (channel === "preview" && role === "player") return refused("not-found");
    const pointer = await channelPointer(db, projectId, channel);
    if (pointer === null) return refused("not-found");
    releaseFilter = eq(engineReleases.id, pointer);
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
    channel = production === release.id ? "production" : preview === release.id ? "preview" : null;
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
    },
  };
}
