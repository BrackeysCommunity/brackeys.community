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
    timezone: "UTC+0",
  },
  badges: [
    { label: "online", variant: "online" },
    { label: "winner", variant: "winner" },
  ],

  stats: {
    projectsShipped: 4,
    projectsLabel: "TOOLS & GAMES",
    jamsEntered: 4,
    jamsBestRank: "1ST",
    skillsListed: 8,
    skillsPendingCount: 1,
    streakDays: 42,
    streakStatus: "online now",
  },

  projects: [
    {
      id: "moth-garden",
      title: "Moth Garden",
      kind: "game",
      year: 2026,
      shortDescription: "cozy idle game about bioluminescent moths and late-night tea",
      bannerUrl: null,
      url: null,
      tags: ["godot", "solo"],
      jamPlacement: null,
    },
    {
      id: "bracketeer",
      title: "bracketeer",
      kind: "tool",
      year: 2025,
      shortDescription: "cli for generating chonky UI components from a JSON spec",
      bannerUrl: null,
      url: null,
      tags: ["cli", "ts", "oss"],
      jamPlacement: null,
    },
    {
      id: "shift-shift",
      title: "Shift-Shift",
      kind: "jam",
      year: 2025,
      shortDescription: "48h jam entry — rhythm platformer with procedural levels",
      bannerUrl: null,
      url: null,
      tags: ["jam"],
      jamPlacement: "PLACED 4/420",
    },
    {
      id: "nightlight-fm",
      title: "nightlight.fm",
      kind: "web",
      year: 2024,
      shortDescription: "tiny radio stations curated by insomniacs, for insomniacs",
      bannerUrl: null,
      url: null,
      tags: ["web audio"],
      jamPlacement: null,
    },
  ],

  editableProjects: [],
  jamLog: [
    {
      jamId: "shift-shift",
      title: "Shift-Shift",
      shortNote: "procedurally-generated rhythm platformer · 48h",
      startedAt: new Date(Date.UTC(2026, 3, 18)),
      rank: 4,
      totalEntries: 420,
      pill: null,
    },
    {
      jamId: "tidepool",
      title: "Tidepool",
      shortNote: "aquatic roguelike, one screen per run",
      startedAt: new Date(Date.UTC(2026, 1, 2)),
      rank: 12,
      totalEntries: 180,
      pill: null,
    },
    {
      jamId: "quiet-town",
      title: "Quiet Town",
      shortNote: "narrative vignette · brackeys jam #28",
      startedAt: new Date(Date.UTC(2025, 10, 14)),
      rank: 1,
      totalEntries: 90,
      pill: "TOP 1",
    },
    {
      jamId: "grain",
      title: "Grain",
      shortNote: "procedural baking sim · brackeys weekly",
      startedAt: new Date(Date.UTC(2025, 7, 3)),
      rank: 23,
      totalEntries: 300,
      pill: null,
    },
  ],
  jamLogBest: {
    jamId: "quiet-town",
    title: "Quiet Town",
    subtitle: "BRACKEYS JAM #28 · 90 ENTRIES",
    rank: 1,
  },

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
