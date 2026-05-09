import type {
  EditableProject,
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
    jamName: string | null;
    submissionTitle: string | null;
    submissionUrl: string | null;
    result: string | null;
    participatedAt: Date | null;
    createdAt: Date;
  }[];
  isOwner: boolean;
  urlStub: string | null;
  pendingSkillRequests: { id: number; name: string; category: string | null }[];
  linkedAccounts: {
    id: number;
    provider: string;
    providerUsername: string | null;
    providerProfileUrl: string | null;
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

  const projects = rpc.projects
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

  // Best jam result (when a project carries a numeric placement).
  const jamProjects = projects.filter((p) => p.kind === "jam" && p.jamPlacement);
  const bestPlacement = jamProjects[0]?.jamPlacement ?? null;

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
      rate: formatRate(profile.rateType, profile.rateMin, profile.rateMax),
      responseTime: null,
      timezone: null,
    },
    badges: [],
    stats: {
      projectsShipped,
      projectsLabel: projectsShipped > 0 ? deriveProjectsLabel(projects) : "—",
      jamsEntered: jamProjects.length,
      jamsBestRank: bestPlacement,
      skillsListed,
      skillsPendingCount: skillsPending,
      streakDays: 0,
      streakStatus: "—",
    },
    projects,
    editableProjects: rpc.projects.map(adaptEditable),
    jamLog: [],
    jamLogBest: null,
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

function adaptEditable(p: RpcProfile["projects"][number]): EditableProject {
  return {
    id: p.id,
    type: p.type,
    subTypes: p.subTypes ?? [],
    title: p.title,
    description: p.description,
    url: p.url,
    imageUrl: p.imageUrl,
    pinned: p.pinned ?? null,
    status: p.status,
    jamName: p.jamName,
    jamUrl: null, // not threaded through the adapter type yet
    submissionTitle: p.submissionTitle,
    submissionUrl: p.submissionUrl,
    result: p.result,
    participatedAt: p.participatedAt,
  };
}

function adaptProject(p: RpcProfile["projects"][number]): ProfileProject {
  const kind = (p.type as ProfileProject["kind"]) ?? "other";
  const year = (p.participatedAt ?? p.createdAt).getUTCFullYear();
  return {
    id: p.id,
    title: p.submissionTitle ?? p.title,
    kind,
    year,
    shortDescription: p.description,
    bannerUrl: p.imageUrl,
    url: p.submissionUrl ?? p.url,
    tags: [...(p.subTypes ?? []), ...(p.tags ?? [])].slice(0, 4),
    jamPlacement: p.result ? formatJamPlacement(p.result) : null,
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

function formatRate(type: string | null, min: number | null, max: number | null): string | null {
  if (!type && min == null && max == null) return null;
  if (min != null && max != null) return `$${min}–$${max} ${type ?? ""}`.trim();
  if (min != null) return `$${min}${type ? ` ${type}` : ""}`;
  return type;
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
