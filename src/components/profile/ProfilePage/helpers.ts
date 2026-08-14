/**
 * View model for the redesigned profile page. The current backend
 * (`getProfile` oRPC) covers most of this, but a few fields don't exist
 * on `developer_profiles` yet (pronouns, location, timezone, response
 * time, streak, activity events). Phase 5 lands those migrations; for
 * the layout-pass phases we hand the components a typed view model and
 * adapt from real data + sample data at the boundary.
 */
export interface ProfileViewModel {
  /** URL stub / handle (no leading @). */
  handle: string;
  /** Big-typography display name (e.g. "JOSHE"). */
  name: string;
  /** Suffix shown beneath the name in outline weight (e.g. "DEV."). */
  tag: string | null;
  pronouns: string | null;
  location: string | null;
  joinedAt: Date;
  /** One-line under the chip row — italicized "shipping weird tools…". */
  oneLiner: string | null;
  /** Long-form bio for the ABOUT section. */
  bio: string | null;
  /** "Pinned" callout under the bio — short, bold, links optional. */
  pinnedNote: string | null;

  avatar: ProfileAvatar;

  availability: ProfileAvailability;
  badges: ProfileBadge[];

  stats: ProfileStats;

  /** Linked itch.io account summary — drives the sync bar under the
   * hero. Null when no itch.io account is linked. */
  itch: ProfileItchSync | null;

  projects: ProfileProject[];
  /** Raw projects in the shape the legacy `EditableProjectCard`
   * consumes (id/title/type/subTypes/url/imageUrl/etc). The owner
   * edit-flow reuses those components verbatim, so we keep this
   * unmapped row alongside the display-friendly `projects` array
   * rather than duplicating editor work. */
  editableProjects: EditableProject[];
  jamLog: JamLogEntry[];
  jamLogBest: JamLogBest | null;
  /** Projects this member is credited on but doesn't showcase — the
   * `project_contributors` join, the portfolio they get for free. */
  credits: ProfileCredit[];

  skills: ProfileSkill[];
  links: ProfileLink[];
  /** Raw profile-level URLs (LINKS-step editable); the LINKED section
   * renders them as virtual accounts when no provider is connected. */
  socialUrls: {
    githubUrl: string | null;
    twitterUrl: string | null;
    websiteUrl: string | null;
  };

  /** Last N weeks of activity, ordered oldest → newest. Each cell is a
   * day count (commits / contributions). */
  activity: ActivityWeek[];
  totalCommits: number;
  /** GitHub login extracted from a linked GitHub account, when
   * present. Drives the embedded contribution-snake graphic at the
   * top of the ACTIVITY section. */
  githubUsername: string | null;
  /** The owning profile's developer id — passed to the existing
   * `ContributionCalendar` so it can fetch the GitHub contribution
   * data via `getContributions`. */
  profileId: string;
  /** Discord user id — drives the visitor "Message on Discord" deep
   * link. Null for profiles without a linked Discord id. */
  discordId: string | null;
  /** Whether the profile wall accepts and shows notes to visitors. */
  notesEnabled: boolean;
}

export interface ProfileAvatar {
  /** Optional uploaded image. If absent we render a chunky generated
   * glyph from the display name's initial. */
  imageUrl: string | null;
  /** First non-whitespace character of `name`, uppercased — used for
   * the generated glyph. */
  glyph: string;
}

export type AvailabilityState = "open" | "selective" | "closed";

export interface ProfileAvailability {
  state: AvailabilityState;
  /** Wire value from the `developer_profiles.availability` enum
   * (`full_time` / `part_time` / `limited`). Render via
   * {@link formatCommitment} to get a display label. */
  commitment: string | null;
  /** Free-form rate hint ("rate: negotiable", "$60/h"). */
  rate: string | null;
  /** Raw rate columns, carried alongside the formatted `rate` string so
   * the edit flyout can seed its inputs from saved values. */
  rateType: string | null;
  rateMin: number | null;
  rateMax: number | null;
  /** Mean response time, surfaced as `~4h`. */
  responseTime: string | null;
  /** Short "what I'm looking for" blurb. The people lane is the
   *  availability listing, so this is what an "I'm available" post would
   *  have said — kept on the profile, where it stays current. */
  lookingFor: string | null;
  /** `paid` / `hobby` / `either` — filters the people lane. */
  collabPreference: string | null;
  /** Display string ("UTC+0", "America/New_York"). */
  timezone: string | null;
}

/** Map an availability commitment wire value (`full_time`,
 * `part_time`, `limited`) to a friendly title-cased label.
 * Falls through to the raw value for unknown inputs. */
export function formatCommitment(commitment: string | null | undefined): string | null {
  if (!commitment) return null;
  switch (commitment) {
    case "full_time":
      return "Full Time";
    case "part_time":
      return "Part Time";
    case "limited":
      return "Limited";
    default:
      return commitment;
  }
}

/** Map a rate-type wire value (`hourly`, `fixed`, `negotiable`) to a
 * title-cased label. */
export function formatRateType(rateType: string | null | undefined): string | null {
  if (!rateType) return null;
  switch (rateType) {
    case "hourly":
      return "Hourly";
    case "fixed":
      return "Fixed";
    case "negotiable":
      return "Negotiable";
    default:
      return rateType;
  }
}

export interface ProfileItchSync {
  /** itch.io username ("mikakell"). */
  username: string | null;
  /** Full profile URL when known. */
  url: string | null;
  /** Display string for the bar ("mikakell.itch.io"). */
  display: string;
  linkedAt: Date;
  /** Count of projects imported from itch.io. */
  gamesCount: number;
}

export interface ProfileBadge {
  label: string;
  variant: "online" | "winner" | "neutral";
}

export interface ProfileStats {
  /** Tools / games / experiments shipped — the projects.length. */
  projectsShipped: number;
  /** A short, hand-picked descriptor under the count (e.g. "TOOLS &
   * GAMES"). */
  projectsLabel: string;
  /** Total jams entered. */
  jamsEntered: number;
  /** Best result string ("1ST", "TOP 5"). */
  jamsBestRank: string | null;
  skillsListed: number;
  /** Count of pending skill requests — surfaced as the secondary
   * label on the SKILLS stat tile. */
  skillsPendingCount: number;
  /** Active-day streak. */
  streakDays: number;
  /** Sub-line under streak — "online now" / "active 2h ago". */
  streakStatus: string;
  /** Notes on the profile wall (thread comment count, tombstones included). */
  wallNotesCount: number;
  /** Distinct people met through the collab loop — a teammate on a roster
   * where either seat came from an accepted response. */
  collabsCount: number;
}

/** Label vocabulary for a project card. The first seven are the canonical
 * kinds (`project.projects.type`); `jam` is placement provenance and
 * `writing` predates the entity — both stay so legacy rows still read. */
export type ProjectKind =
  | "game"
  | "tool"
  | "assets"
  | "audio"
  | "app"
  | "web"
  | "other"
  | "jam"
  | "writing";

/**
 * Raw project row in the shape the legacy `EditableProjectCard`
 * already consumes — kept here so the new profile page can hand it
 * straight back to the existing editor components rather than
 * duplicating the project-management flow.
 */
export interface EditableProject {
  id: string;
  type: string;
  /** The canonical row's kind and secondary links, when the placement is
   * linked to one. The placement's `type` is a pg enum that can't hold
   * `assets` / `web` / `other`, so the editor seeds from these. */
  canonicalType: string | null;
  canonicalLinks: { label: string; url: string }[] | null;
  subTypes: string[];
  title: string;
  description: string | null;
  url: string | null;
  imageUrl: string | null;
  pinned: boolean | null;
  status: string;
  jamName: string | null;
  jamUrl: string | null;
  submissionTitle: string | null;
  submissionUrl: string | null;
  result: string | null;
  participatedAt: Date | null;
  /** Provider publish date (itch.io `published_at`) — preferred over
   * DB insert time when deriving the display year. */
  publishedAt: Date | null;
  /** See `ProfileProject.missing` — owner cards label these. */
  missingSince: Date | null;
}

export interface ProfileProject {
  id: string;
  /** `$projectSlug` for the canonical project page, when this placement is
   * linked to one. Null means the card has no in-app destination and still
   * links out to the provider. */
  projectSlug: string | null;
  title: string;
  kind: ProjectKind;
  year: number;
  shortDescription: string | null;
  bannerUrl: string | null;
  url: string | null;
  tags: string[];
  /** Jam this entry shipped in ("Brackeys Jam 2026.2") — drives the
   * card's sub-line when present. */
  jamName: string | null;
  /** When `kind === "jam"` — small placement chip on the card. */
  jamPlacement: string | null;
  /** Canonical provider platforms ("windows", "osx", …) — platform chips. */
  platforms: string[];
  /** Provider `min_price > 0` — the PAID chip. */
  paid: boolean;
  /** The game vanished from the linked itch library (deleted, or access
   * lost). Public views filter these rows server-side; owners see the card
   * with a "no longer on itch.io" label. */
  missing: boolean;
}

export interface JamLogEntry {
  /** `profile_projects.id` — the jam row itself. A member can enter the
   * same jam twice, so the jam's own id wouldn't be unique here. */
  id: string;
  title: string;
  /** The jam's name, kept separate from `shortNote` so it can carry the
   * link to the jam's own page. */
  jamName: string | null;
  /** `$jamSlug` segment for the jam's page, when the row is linked to a
   * scraped jam. Null for off-itch / free-text jam rows, which have no
   * page here to point at. */
  jamSlug: string | null;
  jamId: number | null;
  shortNote: string | null;
  startedAt: Date;
  /** Entry page (itch rate URL) when known — the log row's title links
   * out to it, the way the project card's OPEN chip did. */
  url: string | null;
  /** Final placement / total entries — drives the "#4 / 420" tag. */
  rank: number | null;
  totalEntries: number | null;
  /** "TOP 1", "TOP 5", "WINNER" — displayed as a small badge when set. */
  pill: string | null;
}

/** One row of the CREDITS section: "Cathedral of Wires · Composer ·
 * with Night Shift Crew". */
export interface ProfileCredit {
  /** `project_contributors.id`. */
  id: number;
  /** `$projectSlug` for the project's page. */
  slug: string;
  title: string;
  role: string | null;
  /** Canonical kind — drives the row's type label. */
  kind: string;
  /** First team claiming the project, when there is one. */
  teamName: string | null;
  year: number | null;
}

/** "Best finish" featured callout that anchors the JAM LOG section. */
export interface JamLogBest {
  id: string;
  title: string;
  /** Bold subtitle ("BRACKEYS JAM #28 · 90 ENTRIES"). */
  subtitle: string;
  /** Place number — drives the chunky "#1" headline. */
  rank: number;
}

/**
 * Skills don't carry user-defined "levels" yet — the schema is just a
 * many-to-many of `userSkills` plus a separate `skillRequests` table
 * for skills the user has asked the moderators to add. We surface the
 * difference between the two as a state on the rendered chip:
 *
 * - `active` — already in the global skill list and assigned to the user
 * - `pending` — submitted as a `skillRequest`, awaiting approval
 */
export type SkillState = "active" | "pending";

export interface ProfileSkill {
  id: number | string;
  name: string;
  state: SkillState;
  /** Optional category label sourced from the skills table (e.g.
   * "engine", "art", "audio") — drives chip grouping. */
  category: string | null;
}

export interface ProfileLink {
  id: string;
  /** Two-letter monogram displayed in the leading well (e.g. "GH"). */
  monogram: string;
  /** Capitalized provider name (e.g. "GITHUB"). */
  label: string;
  /** Full URL. */
  url: string;
  /** Display string under the label (without scheme). */
  display: string;
  /** Owner-only: the provider rejected our stored token (revoked on their
   * side) — surfaces the RECONNECT affordance. */
  needsReconnect?: boolean;
}

/** A row of seven day-counts, oldest → newest, padded with `null` when
 * the user joined mid-week so the heatmap grid stays uniform. */
export type ActivityWeek = (number | null)[];

/** Levels the heatmap renders, computed from a per-week distribution.
 * Six steps mirror GitHub's contribution graph (none → most). */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

/** Bucket a per-day count against this profile's max. Out-of-band 0
 * stays at level 0 ("none"). */
export function heatLevel(count: number, max: number): HeatLevel {
  if (count <= 0) return 0;
  if (max <= 0) return 0;
  const ratio = count / max;
  if (ratio < 0.25) return 1;
  if (ratio < 0.5) return 2;
  if (ratio < 0.75) return 3;
  return 4;
}
