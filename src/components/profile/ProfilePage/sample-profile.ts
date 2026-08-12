import type { ProfileViewModel } from "./helpers";

/**
 * Stand-in profile so we can build the layout without waiting on the
 * schema migrations that lift "pronouns / timezone / response-time /
 * activity events" into `developer_profiles`. Phase 5 swaps this for
 * the real `getProfile` adapter.
 */
export const SAMPLE_PROFILE: ProfileViewModel = {
  handle: "joshe",
  name: "JOSHE",
  tag: "DEV.",
  pronouns: "they/them",
  location: "Lisbon, PT",
  joinedAt: new Date(Date.UTC(2026, 3, 1)),
  oneLiner: "shipping weird tools between 00:00 and dawn",
  bio: "game-adjacent dev who keeps building infra for tiny communities. currently wiring webhooks between [discord](https://discord.com) and [itch](https://itch.io) and a pile of google sheets. prefers 3am, espresso, and code that compiles on the first try (it never does).",
  pinnedNote:
    "currently free for small paid gigs · shader work, tooling, react weirdness · ping me on any linked account.",

  avatar: { imageUrl: null, glyph: "J" },

  availability: {
    state: "open",
    commitment: "part-time",
    rate: "rate: negotiable",
    responseTime: "~4h",
    lookingFor: null,
    collabPreference: null,
    timezone: "UTC+0",
  },
  badges: [
    { label: "online", variant: "online" },
    { label: "winner", variant: "winner" },
  ],

  itch: {
    username: "joshe",
    url: "https://joshe.itch.io",
    display: "joshe.itch.io",
    linkedAt: new Date(Date.UTC(2026, 4, 12)),
    gamesCount: 3,
  },

  stats: {
    projectsShipped: 4,
    projectsLabel: "TOOLS & GAMES",
    jamsEntered: 4,
    jamsBestRank: "1ST",
    skillsListed: 8,
    skillsPendingCount: 1,
    streakDays: 42,
    streakStatus: "online now",
    wallNotesCount: 3,
  },

  projects: [
    {
      id: "moth-garden",
      title: "Moth Garden",
      projectSlug: null,
      kind: "game",
      year: 2026,
      shortDescription: "cozy idle game about bioluminescent moths and late-night tea",
      bannerUrl: null,
      url: null,
      tags: ["godot", "solo"],
      jamName: null,
      jamPlacement: null,
      platforms: [],
      paid: false,
      missing: false,
    },
    {
      id: "bracketeer",
      title: "bracketeer",
      projectSlug: null,
      kind: "tool",
      year: 2025,
      shortDescription: "cli for generating chonky UI components from a JSON spec",
      bannerUrl: null,
      url: null,
      tags: ["cli", "ts", "oss"],
      jamName: null,
      jamPlacement: null,
      platforms: [],
      paid: false,
      missing: false,
    },
    {
      id: "shift-shift",
      title: "Shift-Shift",
      projectSlug: null,
      kind: "jam",
      year: 2025,
      shortDescription: "48h jam entry — rhythm platformer with procedural levels",
      bannerUrl: null,
      url: null,
      tags: ["jam"],
      jamName: "Brackeys Jam 2026.2",
      jamPlacement: "PLACED 4/420",
      platforms: [],
      paid: false,
      missing: false,
    },
    {
      id: "nightlight-fm",
      title: "nightlight.fm",
      projectSlug: null,
      kind: "web",
      year: 2024,
      shortDescription: "tiny radio stations curated by insomniacs, for insomniacs",
      bannerUrl: null,
      url: null,
      tags: ["web audio"],
      jamName: null,
      jamPlacement: null,
      platforms: [],
      paid: false,
      missing: false,
    },
  ],

  // Mirrors `projects` in the raw editor row shape so the owner-mode
  // preview (`/profile/preview` renders `isOwner`) shows the capsule
  // grid instead of the empty state.
  editableProjects: [
    {
      id: "moth-garden",
      type: "game",
      canonicalType: null,
      canonicalLinks: null,
      subTypes: ["godot", "solo"],
      title: "Moth Garden",
      description: "cozy idle game about bioluminescent moths and late-night tea",
      url: null,
      imageUrl: null,
      pinned: true,
      status: "published",
      jamName: null,
      jamUrl: null,
      submissionTitle: null,
      submissionUrl: null,
      result: null,
      participatedAt: new Date(Date.UTC(2026, 1, 10)),
      publishedAt: null,
      missingSince: null,
    },
    {
      id: "bracketeer",
      type: "tool",
      canonicalType: null,
      canonicalLinks: null,
      subTypes: ["cli", "ts"],
      title: "bracketeer",
      description: "cli for generating chonky UI components from a JSON spec",
      url: null,
      imageUrl: null,
      pinned: false,
      status: "published",
      jamName: null,
      jamUrl: null,
      submissionTitle: null,
      submissionUrl: null,
      result: null,
      participatedAt: new Date(Date.UTC(2025, 8, 2)),
      publishedAt: null,
      missingSince: null,
    },
    {
      id: "shift-shift",
      type: "jam",
      canonicalType: null,
      canonicalLinks: null,
      subTypes: ["jam"],
      title: "Shift-Shift",
      description: "48h jam entry — rhythm platformer with procedural levels",
      url: null,
      imageUrl: null,
      pinned: false,
      status: "published",
      jamName: "Brackeys Jam 2026.2",
      jamUrl: null,
      submissionTitle: null,
      submissionUrl: null,
      result: "PLACED 4/420",
      participatedAt: new Date(Date.UTC(2025, 5, 20)),
      publishedAt: null,
      missingSince: null,
    },
    {
      id: "nightlight-fm",
      type: "web",
      canonicalType: null,
      canonicalLinks: null,
      subTypes: ["web audio"],
      title: "nightlight.fm",
      description: "tiny radio stations curated by insomniacs, for insomniacs",
      url: null,
      imageUrl: null,
      pinned: false,
      status: "published",
      jamName: null,
      jamUrl: null,
      submissionTitle: null,
      submissionUrl: null,
      result: null,
      participatedAt: new Date(Date.UTC(2024, 10, 5)),
      publishedAt: null,
      missingSince: null,
    },
  ],
  jamLog: [
    {
      id: "shift-shift",
      title: "Shift-Shift",
      jamName: "Brackeys Game Jam 2026.1",
      jamSlug: "brackeys-15",
      jamId: 402922,
      shortNote: "procedurally-generated rhythm platformer · 48h",
      startedAt: new Date(Date.UTC(2026, 3, 18)),
      url: null,
      rank: 4,
      totalEntries: 420,
      pill: null,
    },
    {
      id: "tidepool",
      title: "Tidepool",
      jamName: "Ludum Dare 57",
      jamSlug: null,
      jamId: null,
      shortNote: "aquatic roguelike, one screen per run",
      startedAt: new Date(Date.UTC(2026, 1, 2)),
      url: null,
      rank: 12,
      totalEntries: 180,
      pill: null,
    },
    {
      id: "quiet-town",
      title: "Quiet Town",
      jamName: "Brackeys Jam #28",
      jamSlug: null,
      jamId: null,
      shortNote: "narrative vignette",
      startedAt: new Date(Date.UTC(2025, 10, 14)),
      url: null,
      rank: 1,
      totalEntries: 90,
      pill: "TOP 1",
    },
    {
      id: "grain",
      title: "Grain",
      jamName: "Brackeys Weekly",
      jamSlug: null,
      jamId: null,
      shortNote: "procedural baking sim",
      startedAt: new Date(Date.UTC(2025, 7, 3)),
      url: null,
      rank: 23,
      totalEntries: 310,
      pill: null,
    },
  ],

  jamLogBest: {
    id: "quiet-town",
    title: "Quiet Town",
    subtitle: "BRACKEYS JAM #28 · 90 ENTRIES",
    rank: 1,
  },

  credits: [
    {
      id: 1,
      slug: "cathedral-of-wires",
      title: "Cathedral of Wires",
      role: "Composer",
      kind: "game",
      teamName: "Night Shift Crew",
      year: 2026,
    },
    {
      id: 2,
      slug: "bramble-tileset",
      title: "Bramble Tileset",
      role: "Palette",
      kind: "assets",
      teamName: null,
      year: 2025,
    },
  ],

  skills: [
    { id: 1, name: "TypeScript", state: "active", category: "engineering" },
    { id: 2, name: "Godot", state: "active", category: "engine" },
    { id: 3, name: "Shader art", state: "active", category: "graphics" },
    { id: 4, name: "Rust", state: "active", category: "engineering" },
    { id: 5, name: "Pixel art", state: "active", category: "art" },
    { id: 6, name: "Web audio", state: "active", category: "audio" },
    { id: 7, name: "React", state: "active", category: "engineering" },
    { id: 8, name: "sqlite", state: "active", category: "engineering" },
    { id: 9, name: "Three.js", state: "pending", category: "graphics" },
  ],

  links: [
    {
      id: "github",
      monogram: "GH",
      label: "GITHUB",
      url: "https://github.com/joshe",
      display: "github.com/joshe",
    },
    {
      id: "itch",
      monogram: "IT",
      label: "ITCH.IO",
      url: "https://joshe.itch.io",
      display: "joshe.itch.io",
    },
    {
      id: "portfolio",
      monogram: "WE",
      label: "PORTFOLIO",
      url: "https://joshe.dev",
      display: "joshe.dev",
    },
    {
      id: "mastodon",
      monogram: "MA",
      label: "MASTODON",
      url: "https://mastodon.social/@joshe",
      display: "@joshe@mastodon.social",
    },
  ],

  activity: buildSampleActivity(),
  totalCommits: 128,
  githubUsername: "joshe",
  profileId: "sample",
  discordId: null,
  notesEnabled: true,
};

/** Generates 14 weeks × 7 days of plausible activity counts so the
 * heatmap has visual texture during layout work. */
function buildSampleActivity() {
  const weeks: (number | null)[][] = [];
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed % 1000) / 1000;
  };
  for (let w = 0; w < 14; w++) {
    const week: (number | null)[] = [];
    for (let d = 0; d < 7; d++) {
      const r = rand();
      if (r < 0.3) week.push(0);
      else if (r < 0.6) week.push(1 + Math.floor(rand() * 3));
      else if (r < 0.85) week.push(3 + Math.floor(rand() * 4));
      else week.push(7 + Math.floor(rand() * 6));
    }
    weeks.push(week);
  }
  return weeks;
}
