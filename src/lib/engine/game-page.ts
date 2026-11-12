import { parseReleaseManifest } from "@jams/engine/project";
import { and, eq, isNull } from "drizzle-orm";

import { db as siteDb } from "@/db";
import {
  developerProfiles,
  engineProjects,
  engineReleases,
  profileUrlStubs,
  projectContributors,
  projectTeams,
  projects,
  teams,
} from "@/db/schema";
import {
  getProfileProjectImageUrl,
  resolveTeamAvatarUrl,
} from "@/lib/profile-project-image-storage";
import { profileStubJoin } from "@/orpc/profile-projection";

import { frameBase } from "./frame-csp";
import { mintFrameToken } from "./frame-token";
import type { GameSaveMode } from "./game-settings";
import {
  canDo,
  canPlay,
  roleOf,
  type GameRole,
  type GameVisibility,
  type Viewer,
} from "./release-access";
import { listReleases, type ReleaseSummary } from "./release-channels";
import type { ReleaseTxDb } from "./release-upload";

/** What a publisher's menu offers on a version: production moves, a jam link, the zip. */
export type GameVersionAction = "promote" | "rollback" | "jam-link" | "download-zip";

export type GamePageVersion = {
  /** Only on versions whose actions include "download-zip": the zip route takes it. */
  id?: string;
  version: number;
  createdAt: string;
  bytes: number;
  engineVersion: string;
  badges: ("live" | "preview" | "jam")[];
  /** The jams this version is the submitted version of, for "Jam version: <title>". */
  jams: { jamId: number; title: string }[];
  playUrl: string;
  /** Only ever on preview: the people who make the game see it, players don't. */
  previewOnly: boolean;
  /** Publishers only: staff hid it, so nobody can play it. */
  hidden: { reason: string | null } | null;
  /** Publishers only: when the cleanup removes it unless something pins it. */
  removalAt: string | null;
  /** Publishers only: "Removed on 26 Nov unless pinned". */
  removalNotice: string | null;
  actions: GameVersionAction[];
};

export type GamePageContributor = {
  id: number;
  profileId: string | null;
  displayName: string;
  role: string | null;
  avatarUrl: string | null;
  guildAvatarUrl: string | null;
  urlStub: string | null;
};

export type GamePageTeam = { id: string; name: string; slug: string; avatarUrl: string | null };

/** The game page: its identity, the versions this viewer may play, and the saves and privacy lines. */
export type GamePagePayload = {
  projectId: string;
  title: string;
  description: string | null;
  showcaseProjectId: string | null;
  /** The showcase project's slug, for a link to its page. */
  showcaseSlug: string | null;
  cover: { imageKey: string | null; url: string | null };
  contributors: GamePageContributor[];
  teams: GamePageTeam[];
  visibility: GameVisibility;
  /** Publishers only: a first `public` waiting for staff, shown as `unlisted` meanwhile. */
  reviewPending: boolean;
  saveMode: GameSaveMode;
  connectOrigins: string[];
  /** Newest first. */
  versions: GamePageVersion[];
  /** The version production plays, when this viewer may play it: the big Play button. */
  live: { version: number; playUrl: string } | null;
  /** The `<iframe>` snippet is offered for public and unlisted games with a live version. */
  embeddable: boolean;
  credits: { url: string; version: number } | null;
  /** Publishers only: shipped assets with no licence recorded in the credits' release. */
  creditsMissing: number;
  /** Staff or a publisher: sees the menu, the review state and removal dates. */
  publisher: boolean;
  role: GameRole;
  /** Publishers only: the reason staff gave when they hid the whole game. */
  hidden: { reason: string | null } | null;
  noindex: boolean;
  viewer: { signedIn: boolean };
};

export type GamePageDeps = {
  db?: ReleaseTxDb;
  now?: () => Date;
  /** Where frames are served from; default `playOrigin()`. */
  playOrigin?: string;
};

const CREDITS_FILE = "credits.html";

/** A release the visibility's audience plays, for asking who that audience is. */
const ONCE_LIVE = {
  hiddenAt: null,
  collectedAt: null,
  firstPromotedAt: new Date(0),
  jamPinned: false,
} as const;

/** "26 Nov", UTC like every jam date. */
const dayMonth = (at: Date) =>
  at.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export const removalNotice = (at: Date): string => `Removed on ${dayMonth(at)} unless pinned`;

const isPrivate = (visibility: GameVisibility) => visibility === "private" || visibility === "team";

async function showcaseIdentity(db: ReleaseTxDb, showcaseProjectId: string) {
  const [[row], contributorRows, teamRows] = await Promise.all([
    db
      .select({
        title: projects.title,
        slug: projects.slug,
        description: projects.description,
        imageKey: projects.imageKey,
        imageUrl: projects.imageUrl,
      })
      .from(projects)
      .where(eq(projects.id, showcaseProjectId))
      .limit(1),
    db
      .select({
        id: projectContributors.id,
        profileId: projectContributors.profileId,
        displayName: projectContributors.displayName,
        role: projectContributors.role,
        avatarUrl: developerProfiles.avatarUrl,
        guildAvatarUrl: developerProfiles.guildAvatarUrl,
        username: developerProfiles.guildNickname,
        discordUsername: developerProfiles.discordUsername,
        urlStub: profileUrlStubs.stub,
      })
      .from(projectContributors)
      .leftJoin(developerProfiles, eq(projectContributors.profileId, developerProfiles.id))
      .leftJoin(profileUrlStubs, profileStubJoin)
      .where(eq(projectContributors.projectId, showcaseProjectId))
      .orderBy(projectContributors.sortOrder, projectContributors.id),
    db
      .select({
        id: teams.id,
        name: teams.name,
        slug: teams.slug,
        avatarUrl: teams.avatarUrl,
        avatarKey: teams.avatarKey,
      })
      .from(projectTeams)
      .innerJoin(teams, eq(projectTeams.teamId, teams.id))
      .where(eq(projectTeams.projectId, showcaseProjectId))
      .orderBy(projectTeams.id),
  ]);
  if (!row) return null;
  return {
    title: row.title,
    slug: row.slug,
    description: row.description,
    cover: {
      imageKey: row.imageKey,
      url: (await getProfileProjectImageUrl(row.imageKey)) ?? row.imageUrl,
    },
    contributors: contributorRows.map(({ username, discordUsername, ...c }) => ({
      ...c,
      displayName: c.displayName || username || discordUsername || "Unknown",
    })),
    teams: await Promise.all(
      teamRows.map(async ({ avatarKey, ...t }) => ({
        ...t,
        avatarUrl: await resolveTeamAvatarUrl({ avatarKey, avatarUrl: t.avatarUrl }),
      })),
    ),
  };
}

/** The production moves, jam link and zip `canDo` lets this role make on one version. */
function versionActions(
  role: GameRole,
  release: ReleaseSummary,
  productionVersion: number | null,
  visibility: GameVisibility,
): GameVersionAction[] {
  if (release.collectedAt !== null) return [];
  const actions: GameVersionAction[] = [];
  if (release.hidden === null && !release.channels.includes("production")) {
    if (productionVersion === null || release.version > productionVersion) {
      if (canDo(role, "promote-production")) actions.push("promote");
    } else if (canDo(role, "rollback-production")) {
      actions.push("rollback");
    }
  }
  const linkable = visibility === "public" || visibility === "unlisted";
  if (release.hidden === null && linkable && canDo(role, "jam-link")) actions.push("jam-link");
  if (canDo(role, "download-zip")) actions.push("download-zip");
  return actions;
}

async function creditsMissingOf(db: ReleaseTxDb, releaseId: string): Promise<number> {
  const [row] = await db
    .select({ manifest: engineReleases.manifest })
    .from(engineReleases)
    .where(eq(engineReleases.id, releaseId))
    .limit(1);
  const parsed = row?.manifest ? parseReleaseManifest(row.manifest) : null;
  return parsed?.ok ? parsed.manifest.credits.missing.length : 0;
}

/**
 * The game page as this viewer may see it, or null when the game doesn't
 * exist for them: a missing project, a visibility that doesn't admit them,
 * or a hidden game for anyone but its publishers. Which versions are listed
 * is `canPlay`'s answer per release; publishers also see hidden versions,
 * when the cleanup removes each, and the menu `canDo` allows them.
 */
export async function gamePage(
  input: { projectId: string; viewer: Viewer },
  deps: GamePageDeps = {},
): Promise<GamePagePayload | null> {
  const db = deps.db ?? (siteDb as unknown as ReleaseTxDb);
  const now = deps.now ?? (() => new Date());
  const { projectId, viewer } = input;

  const [project] = await db
    .select({
      name: engineProjects.name,
      teamId: engineProjects.teamId,
      visibility: engineProjects.visibility,
      showcaseProjectId: engineProjects.showcaseProjectId,
      reviewRequestedAt: engineProjects.publicReviewRequestedAt,
      approvedAt: engineProjects.publicApprovedAt,
      hiddenAt: engineProjects.hiddenAt,
      hiddenReason: engineProjects.hiddenReason,
      saveMode: engineProjects.saveMode,
      connectOrigins: engineProjects.connectOrigins,
    })
    .from(engineProjects)
    .where(and(eq(engineProjects.projectId, projectId), isNull(engineProjects.deletedAt)))
    .limit(1);
  if (!project) return null;

  const visibility = project.visibility as GameVisibility;
  const role = roleOf(viewer, project);
  const publisher = canDo(role, "settings");
  const audience = { visibility, teamId: project.teamId, hiddenAt: null };
  if (!canPlay(viewer, audience, ONCE_LIVE).ok && role === "player") return null;
  if (project.hiddenAt !== null && !publisher) return null;

  // The whole list, read as the site; each release is then kept or dropped for this viewer.
  const releases = await listReleases(
    { projectId, actor: { kind: "staff", userId: viewer.userId ?? "" } },
    { db, now },
  );
  const productionVersion =
    releases.find((r) => r.channels.includes("production"))?.version ?? null;

  const versions: (GamePageVersion & { id: string })[] = [];
  for (const release of releases) {
    if (release.collectedAt !== null) continue;
    const jamPinned = release.jams.length > 0;
    const playable = canPlay(
      viewer,
      { visibility, teamId: project.teamId, hiddenAt: project.hiddenAt },
      {
        hiddenAt: release.hidden?.at ?? null,
        collectedAt: release.collectedAt,
        firstPromotedAt: release.firstPromotedAt,
        jamPinned,
      },
    ).ok;
    const hidden = release.hidden !== null || project.hiddenAt !== null;
    if (!playable && !(publisher && hidden)) continue;
    const badges: GamePageVersion["badges"] = [];
    if (release.channels.includes("production")) badges.push("live");
    if (release.channels.includes("preview")) badges.push("preview");
    if (jamPinned) badges.push("jam");
    versions.push({
      id: release.id,
      version: release.version,
      createdAt: release.createdAt.toISOString(),
      bytes: release.totalBytes,
      engineVersion: release.engineVersion,
      badges,
      jams: release.jams,
      playUrl: release.playUrl,
      previewOnly: release.firstPromotedAt === null && !jamPinned,
      hidden: publisher && release.hidden ? { reason: release.hidden.reason } : null,
      removalAt: publisher && release.removalAt ? release.removalAt.toISOString() : null,
      removalNotice: publisher && release.removalAt ? removalNotice(release.removalAt) : null,
      actions: versionActions(role, release, productionVersion, visibility),
    });
  }

  const playableVersions = versions.filter((v) => v.hidden === null && project.hiddenAt === null);
  const liveRelease = playableVersions.find((v) => v.badges.includes("live")) ?? null;
  const creditsRelease = liveRelease ?? playableVersions[0] ?? null;

  let credits: GamePagePayload["credits"] = null;
  if (creditsRelease) {
    let token: string | undefined;
    if (isPrivate(visibility) && viewer.userId !== null) {
      token =
        (await mintFrameToken({
          releaseId: creditsRelease.id,
          userId: viewer.userId,
          now: now(),
        })) ?? undefined;
    }
    if (!isPrivate(visibility) || token !== undefined) {
      credits = {
        url: `${frameBase(creditsRelease.id, token, deps.playOrigin)}${CREDITS_FILE}`,
        version: creditsRelease.version,
      };
    }
  }

  const identity = project.showcaseProjectId
    ? await showcaseIdentity(db, project.showcaseProjectId)
    : null;

  return {
    projectId,
    title: identity?.title ?? project.name,
    description: identity?.description ?? null,
    showcaseProjectId: identity ? project.showcaseProjectId : null,
    showcaseSlug: identity?.slug ?? null,
    cover: identity?.cover ?? { imageKey: null, url: null },
    contributors: identity?.contributors ?? [],
    teams: identity?.teams ?? [],
    visibility,
    reviewPending: publisher && project.reviewRequestedAt !== null && project.approvedAt === null,
    saveMode: project.saveMode as GameSaveMode,
    connectOrigins: [...project.connectOrigins],
    versions: versions.map(({ id, ...v }) =>
      v.actions.includes("download-zip") ? { ...v, id } : v,
    ),
    live: liveRelease ? { version: liveRelease.version, playUrl: liveRelease.playUrl } : null,
    embeddable: liveRelease !== null && (visibility === "public" || visibility === "unlisted"),
    credits,
    creditsMissing: publisher && creditsRelease ? await creditsMissingOf(db, creditsRelease.id) : 0,
    publisher,
    role,
    hidden: project.hiddenAt !== null ? { reason: project.hiddenReason } : null,
    noindex: visibility !== "public" || project.hiddenAt !== null,
    viewer: { signedIn: viewer.userId !== null },
  };
}
