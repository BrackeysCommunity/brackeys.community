import { formatRate } from "@/lib/format-rate";

import type {
  EditableProject,
  JamLogBest,
  JamLogEntry,
  ProfileBadge,
  ProfileCredit,
  ProfileItchSync,
  ProfileLink,
  ProfileProject,
  ProfileSkill,
  ProfileViewModel,
} from "./helpers";

/**
 * Shape of the `getProfile` oRPC handler's success response (the
 * narrowed `non-null` form). Mirrors the relevant fields rather than
 * re-exporting the type so the adapter stays decoupled from the
 * router internals — if the RPC shape changes, this file is the
 * single update point.
 */
export interface RpcProfile {
  profile: {
    id: string;
    discordUsername: string | null;
    guildNickname: string | null;
    avatarUrl: string | null;
    bio: string | null;
    tagline: string | null;
    githubUrl: string | null;
    twitterUrl: string | null;
    websiteUrl: string | null;
    availableForWork: boolean | null;
    availability: string | null;
    lookingFor: string | null;
    collabPreference: string | null;
    rateType: string | null;
    rateMin: number | null;
    rateMax: number | null;
    createdAt: Date;
    guildJoinedAt: Date | null;
  };
  skills: { id: number; skillId: number; name: string; category: string | null }[];
  projects: {
    id: string;
    type: string;
    subTypes: string[] | null;
    title: string;
    description: string | null;
    url: string | null;
    imageUrl: string | null;
    tags: string[] | null;
    pinned: boolean | null;
    sortOrder: number | null;
    status: string;
    source: string;
    jamId: number | null;
    jamName: string | null;
    jamUrl: string | null;
    /** Scraped jam slug — the `$jamSlug` segment of the jam's own page. */
    jamSlug: string | null;
    /** Canonical project slug, when the placement is linked to one. */
    projectSlug: string | null;
    /** The canonical row's kind (`assets`, `web`, … — the placement's own
     * `type` is a pg enum that can't hold those) and its secondary links. */
    canonicalType: string | null;
    canonicalLinks: { label: string; url: string }[] | null;
    /** Canonical provider facts — platform chips and the PAID chip. */
    canonicalPlatforms: string[] | null;
    canonicalMinPrice: number | null;
    /** The game left the linked itch library (deleted, or access lost). */
    missingSince: Date | null;
    /** When the jam itself ran — from the scraped `itch.jams` join. */
    jamStartsAt: Date | null;
    jamEntriesCount: number | null;
    /** Overall placement scraped off the entry's rate page, once voting
     * has closed. Null for manual rows and un-scored entries. */
    jamOverallRank: number | null;
    submissionTitle: string | null;
    submissionUrl: string | null;
    result: string | null;
    participatedAt: Date | null;
    publishedAt: Date | null;
    createdAt: Date;
  }[];
  /** Projects the member is credited on but doesn't showcase — already
   * filtered against their placements server-side. */
  credits: {
    id: number;
    projectId: string;
    slug: string;
    title: string;
    type: string;
    role: string | null;
    releasedAt: Date | null;
    team: { name: string; slug: string } | null;
  }[];
  isOwner: boolean;
  urlStub: string | null;
  pendingSkillRequests: { id: number; name: string; category: string | null }[];
  linkedAccounts: {
    id: number;
    provider: string;
    providerUsername: string | null;
    providerProfileUrl: string | null;
    tokenInvalidAt: Date | null;
    linkedAt: Date;
  }[];
}

/**
 * Adapt the `getProfile` oRPC response into the typed view model the
 * redesigned profile page consumes. Fields that don't exist on
 * `developer_profiles` yet (pronouns, location, timezone, response
 * time, streak, activity) come back as `null` / sensible empty
 * defaults so the page's empty states + "—" formatting kick in
 * automatically. Phase 5 lands the migrations and this adapter
 * starts pulling those values for real.
 */
export function adaptProfile(rpc: RpcProfile): ProfileViewModel {
  const { profile } = rpc;
  const handle = rpc.urlStub ?? profile.discordUsername ?? profile.id;
  const displayName = (profile.guildNickname ?? profile.discordUsername ?? handle).trim();
  const tag = profile.tagline?.trim() || null;
  const glyph = (displayName.match(/\S/)?.[0] ?? "?").toUpperCase();

  // Jam participations get their own section rather than a capsule in the
  // grid: the itch.io backfill writes them as `type: "jam"` rows alongside
  // the library import of the same game, so leaving them in SHIPPED WORK
  // showed the title twice while JAM LOG sat empty.
  const jamRows = rpc.projects.filter(isJamRow);
  const workRows = rpc.projects.filter((p) => !isJamRow(p));

  const jamLog = jamRows
    .map(adaptJamLogEntry)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  const jamLogBest = deriveJamLogBest(jamRows);
  const rankedFinishes = jamLog.map((e) => e.rank).filter((r) => r != null);
  const bestRank = rankedFinishes.length > 0 ? Math.min(...rankedFinishes) : null;

  const projects = workRows
    .slice()
    .sort((a, b) => {
      // Pinned first, then sortOrder ascending, then most recent
      // participatedAt / createdAt descending so the user's most
      // surfaced work lands at the top of the grid.
      const ap = a.pinned ? 1 : 0;
      const bp = b.pinned ? 1 : 0;
      if (ap !== bp) return bp - ap;
      const ao = a.sortOrder ?? 0;
      const bo = b.sortOrder ?? 0;
      if (ao !== bo) return ao - bo;
      const ad = (a.participatedAt ?? a.createdAt).getTime();
      const bd = (b.participatedAt ?? b.createdAt).getTime();
      return bd - ad;
    })
    .map(adaptProject);

  const skills: ProfileSkill[] = [
    ...rpc.skills.map<ProfileSkill>((s) => ({
      id: s.skillId,
      name: s.name,
      state: "active",
      category: s.category,
    })),
    ...rpc.pendingSkillRequests.map<ProfileSkill>((s) => ({
      id: `request-${s.id}`,
      name: s.name,
      state: "pending",
      category: s.category,
    })),
  ];

  const githubAccount = rpc.linkedAccounts.find((acc) => acc.provider === "github");
  const githubUsername =
    githubAccount?.providerUsername ??
    extractGithubUsername(githubAccount?.providerProfileUrl ?? profile.githubUrl ?? null);

  const links: ProfileLink[] = rpc.linkedAccounts
    .filter((acc) => acc.providerProfileUrl)
    .map((acc) => ({
      id: String(acc.id),
      monogram: providerMonogram(acc.provider),
      label: acc.provider.toUpperCase(),
      url: acc.providerProfileUrl ?? "",
      display: acc.providerUsername ?? acc.providerProfileUrl ?? acc.provider,
      // Owner-only affordance; visitors never see the health of someone
      // else's token.
      needsReconnect: rpc.isOwner && acc.tokenInvalidAt != null,
    }));
  // Surface profile-level URLs as virtual linked accounts when the
  // user hasn't connected the corresponding provider yet — keeps the
  // section meaningful for users who only filled in the legacy text
  // fields.
  if (profile.githubUrl && !links.some((l) => l.label === "GITHUB")) {
    links.push({
      id: "github-url",
      monogram: "GH",
      label: "GITHUB",
      url: profile.githubUrl,
      display: stripUrlScheme(profile.githubUrl),
    });
  }
  if (profile.websiteUrl && !links.some((l) => l.label === "WEBSITE" || l.label === "PORTFOLIO")) {
    links.push({
      id: "website-url",
      monogram: "WE",
      label: "PORTFOLIO",
      url: profile.websiteUrl,
      display: stripUrlScheme(profile.websiteUrl),
    });
  }
  if (profile.twitterUrl && !links.some((l) => l.label === "TWITTER" || l.label === "X")) {
    links.push({
      id: "twitter-url",
      monogram: "TW",
      label: "TWITTER",
      url: profile.twitterUrl,
      display: stripUrlScheme(profile.twitterUrl),
    });
  }

  const projectsShipped = projects.length;
  const skillsListed = skills.filter((s) => s.state === "active").length;
  const skillsPending = skills.filter((s) => s.state === "pending").length;

  const itchAccount = rpc.linkedAccounts.find(
    (acc) => acc.provider === "itchio" || acc.provider === "itch.io",
  );
  const itch: ProfileItchSync | null = itchAccount
    ? {
        username: itchAccount.providerUsername,
        url: itchAccount.providerProfileUrl,
        display:
          (itchAccount.providerProfileUrl && stripUrlScheme(itchAccount.providerProfileUrl)) ||
          (itchAccount.providerUsername ? `${itchAccount.providerUsername}.itch.io` : "itch.io"),
        linkedAt: itchAccount.linkedAt,
        gamesCount: rpc.projects.filter((p) => p.source === "itchio").length,
      }
    : null;

  const badges: ProfileBadge[] = [];
  // A scraped overall rank of 1 is the reliable signal; the text test still
  // covers manually-entered results ("Winner", "1st").
  if (jamLog.some((e) => e.rank === 1) || rpc.projects.some((p) => isWinnerText(p.result))) {
    badges.push({ label: "jam winner", variant: "winner" });
  }
  if (profile.availableForWork) {
    badges.push({ label: "available", variant: "online" });
  }

  return {
    handle,
    name: displayName.toUpperCase(),
    tag,
    pronouns: null,
    location: null,
    joinedAt: profile.guildJoinedAt ?? profile.createdAt,
    oneLiner: null,
    bio: profile.bio,
    pinnedNote: null,
    avatar: { imageUrl: profile.avatarUrl, glyph },
    availability: {
      state: profile.availableForWork ? "open" : "closed",
      commitment: profile.availability,
      rate:
        formatRate(profile.rateType, profile.rateMin, profile.rateMax, {
          negotiableLabel: "Negotiable",
        }) || null,
      responseTime: null,
      timezone: null,
      lookingFor: profile.lookingFor,
      collabPreference: profile.collabPreference,
    },
    badges,
    stats: {
      projectsShipped,
      projectsLabel: projectsShipped > 0 ? deriveProjectsLabel(projects) : "—",
      // Every jam counts, scored or not — the old count only saw entries
      // whose results had already been scraped.
      jamsEntered: jamLog.length,
      // Derived from the log rather than `jamLogBest`, which is withheld for
      // unremarkable finishes: the ledger row is a plain readout, so it can
      // state the number where the trophy callout would be tactless.
      jamsBestRank: bestRank != null ? `#${bestRank}` : null,
      skillsListed,
      skillsPendingCount: skillsPending,
      streakDays: 0,
      streakStatus: "—",
    },
    itch,
    projects,
    // Owner-side editing covers manual/library rows only — jam rows are
    // maintained by the itch.io participation sync.
    editableProjects: workRows.map(adaptEditable),
    jamLog,
    jamLogBest,
    credits: rpc.credits.map<ProfileCredit>((credit) => ({
      id: credit.id,
      slug: credit.slug,
      title: credit.title,
      role: credit.role,
      kind: credit.type,
      teamName: credit.team?.name ?? null,
      year: credit.releasedAt?.getUTCFullYear() ?? null,
    })),
    skills,
    links,
    activity: [],
    totalCommits: 0,
    githubUsername,
    profileId: profile.id,
  };
}

function extractGithubUsername(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/github\.com\/([^/?#]+)/i);
  if (!m || !m[1]) return null;
  // Strip a trailing slash if the URL had one before any query
  // string. Paths like `/orgs/foo` aren't user profiles, so guard
  // against multi-segment captures by taking only the first.
  return m[1].replace(/\/.*$/, "");
}

type RpcProject = RpcProfile["projects"][number];

/** A jam participation rather than a shipped project. `type` is
 * authoritative for the itch.io backfill; the jam link catches manual rows
 * added through the jam-linking flow. */
function isJamRow(p: RpcProject): boolean {
  return p.type === "jam" || p.jamId != null || p.jamName != null;
}

/** Numeric placement, preferring the scraped rank over a `result` string
 * the member typed themselves. Non-numeric results ("Top 5", "Winner")
 * stay text and surface as the row's pill instead. */
function jamRank(p: RpcProject): number | null {
  if (p.jamOverallRank != null) return p.jamOverallRank;
  const n = p.result != null && p.result.trim() !== "" ? Number(p.result) : NaN;
  return Number.isFinite(n) ? n : null;
}

function isWinnerText(result: string | null): boolean {
  return result != null && /^1$|winner|1st/i.test(result);
}

function adaptJamLogEntry(p: RpcProject): JamLogEntry {
  const rank = jamRank(p);
  // Prefer when the jam ran; fall back through the entry's own dates so a
  // manual row without a linked jam still lands on the right date.
  const startedAt = p.jamStartsAt ?? p.participatedAt ?? p.publishedAt ?? p.createdAt;
  return {
    id: p.id,
    title: p.submissionTitle ?? p.title,
    // The jam name is its own field now (it carries the link to the jam's
    // page); the note is whatever the row says beyond that.
    jamName: p.jamName?.trim() || null,
    jamSlug: p.jamSlug,
    jamId: p.jamId,
    shortNote: p.description?.trim() || null,
    startedAt,
    url: p.submissionUrl ?? p.url,
    rank,
    totalEntries: p.jamEntriesCount,
    pill: rank == null && p.result ? p.result.toUpperCase() : null,
  };
}

/** A finish worth putting a trophy on: top ten outright, or top decile of a
 * large field. Everything else is still listed in the log with its rank —
 * it just doesn't get the callout, because "BEST FINISH #3212 of 3511"
 * reads as a burn rather than an achievement. */
function isNotableFinish(rank: number, totalEntries: number | null): boolean {
  if (rank <= 10) return true;
  return totalEntries != null && totalEntries > 0 && rank <= Math.ceil(totalEntries * 0.1);
}

/** Lowest overall placement across the member's ranked entries. Jams still
 * in voting carry no rank and can't win the callout. */
function deriveJamLogBest(jamRows: RpcProject[]): JamLogBest | null {
  let best: { row: RpcProject; rank: number } | null = null;
  for (const row of jamRows) {
    const rank = jamRank(row);
    if (rank == null) continue;
    if (best == null || rank < best.rank) best = { row, rank };
  }
  if (!best) return null;
  const { row, rank } = best;
  if (!isNotableFinish(rank, row.jamEntriesCount)) return null;
  const subtitle = [row.jamName, row.jamEntriesCount ? `${row.jamEntriesCount} ENTRIES` : null]
    .filter(Boolean)
    .join(" · ")
    .toUpperCase();
  return {
    id: row.id,
    title: row.submissionTitle ?? row.title,
    subtitle,
    rank,
  };
}

function adaptEditable(p: RpcProfile["projects"][number]): EditableProject {
  return {
    id: p.id,
    type: p.type,
    canonicalType: p.canonicalType,
    canonicalLinks: p.canonicalLinks,
    subTypes: p.subTypes ?? [],
    title: p.title,
    description: p.description,
    url: p.url,
    imageUrl: p.imageUrl,
    pinned: p.pinned ?? null,
    status: p.status,
    jamName: p.jamName,
    jamUrl: p.jamUrl,
    submissionTitle: p.submissionTitle,
    submissionUrl: p.submissionUrl,
    result: p.result,
    participatedAt: p.participatedAt,
    publishedAt: p.publishedAt,
    missingSince: p.missingSince,
  };
}

function adaptProject(p: RpcProfile["projects"][number]): ProfileProject {
  // The canonical kind wins: the placement's enum can't say "assets" or
  // "web", so an asset pack imported or added by hand would read as TOOL.
  const kind = ((p.canonicalType ?? p.type) as ProfileProject["kind"]) ?? "other";
  // Prefer the jam participation date, then the provider publish date
  // (itch.io `published_at`) — `createdAt` is only when the row landed
  // in our DB, which is wrong for back-catalogue imports.
  const year = (p.participatedAt ?? p.publishedAt ?? p.createdAt).getUTCFullYear();
  return {
    id: p.id,
    projectSlug: p.projectSlug,
    title: p.submissionTitle ?? p.title,
    kind,
    year,
    shortDescription: p.description,
    bannerUrl: p.imageUrl,
    url: p.submissionUrl ?? p.url,
    tags: [...(p.subTypes ?? []), ...(p.tags ?? [])].slice(0, 4),
    jamName: p.jamName,
    jamPlacement: p.result ? formatJamPlacement(p.result) : null,
    platforms: p.canonicalPlatforms ?? [],
    paid: (p.canonicalMinPrice ?? 0) > 0,
    missing: p.missingSince != null,
  };
}

function deriveProjectsLabel(projects: ProfileProject[]): string {
  const kinds = new Set(projects.map((p) => p.kind));
  const order: ProfileProject["kind"][] = ["tool", "game", "jam", "web", "writing", "other"];
  const present = order.filter((k) => kinds.has(k));
  return (
    present
      .map((k) => k.toUpperCase())
      .slice(0, 2)
      .join(" & ") || "—"
  );
}

function formatJamPlacement(result: string): string {
  // `result` is a free-form string in the schema. If it parses to a
  // number, render `PLACED N`; otherwise pass through (already the
  // user's preferred phrasing — "TOP 5", "WINNER", etc.).
  const n = Number(result);
  if (Number.isFinite(n)) return `PLACED ${n}`;
  return result.toUpperCase();
}

function stripUrlScheme(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function providerMonogram(provider: string): string {
  const map: Record<string, string> = {
    github: "GH",
    itchio: "IT",
    "itch.io": "IT",
    discord: "DC",
    twitter: "TW",
    x: "X",
    mastodon: "MA",
    bluesky: "BS",
    youtube: "YT",
    twitch: "TV",
    portfolio: "WE",
    website: "WE",
  };
  const key = provider.toLowerCase();
  return map[key] ?? provider.slice(0, 2).toUpperCase();
}
