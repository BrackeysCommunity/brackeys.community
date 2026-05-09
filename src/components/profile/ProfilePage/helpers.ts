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

  projects: ProfileProject[];
  /** Raw projects in the shape the legacy `EditableProjectCard`
   * consumes (id/title/type/subTypes/url/imageUrl/etc). The owner
   * edit-flow reuses those components verbatim, so we keep this
   * unmapped row alongside the display-friendly `projects` array
   * rather than duplicating editor work. */
  editableProjects: EditableProject[];
  jamLog: JamLogEntry[];
  jamLogBest: JamLogBest | null;

  skills: ProfileSkill[];
  links: ProfileLink[];

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
  /** Mean response time, surfaced as `~4h`. */
  responseTime: string | null;
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
}

export type ProjectKind = "game" | "tool" | "jam" | "web" | "writing" | "other";

/**
 * Raw project row in the shape the legacy `EditableProjectCard`
 * already consumes — kept here so the new profile page can hand it
 * straight back to the existing editor components rather than
 * duplicating the project-management flow.
 */
export interface EditableProject {
  id: string;
  type: string;
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
}

export interface ProfileProject {
  id: string;
  title: string;
  kind: ProjectKind;
  year: number;
  shortDescription: string | null;
  bannerUrl: string | null;
  url: string | null;
  tags: string[];
  /** When `kind === "jam"` — small placement chip on the card. */
  jamPlacement: string | null;
}

export interface JamLogEntry {
  jamId: string;
  title: string;
  shortNote: string | null;
  startedAt: Date;
  /** Final placement / total entries — drives the "#4 / 420" tag. */
  rank: number | null;
  totalEntries: number | null;
  /** "TOP 1", "TOP 5", "WINNER" — displayed as a small badge when set. */
  pill: string | null;
}

/** "Best finish" featured callout that anchors the JAM LOG section. */
export interface JamLogBest {
  jamId: string;
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
