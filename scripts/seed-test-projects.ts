/**
 * Staging seed for the projects entity + detail pages. Exercises every
 * surface the plan built: all seven kinds, sub-types, the links rail,
 * credits (owner / linked member / free-text / scraped `entry-contributors`),
 * team claims (the "MADE BY" section has no live coverage otherwise),
 * explicit and derived jam records, legacy vs. post-step-6 placements,
 * unpublished / restricted / unanchored rows, the editor-rights matrix
 * (yours, a stranger's, a team's, nobody's), and — Part 8 — collab posts
 * linked to canonical projects.
 *
 * Everything it writes is prefixed so it can be removed in one pass:
 *   project.projects.id            seedproj-*   (credits/claims/jam links cascade)
 *   user.profile_projects.id       seedpp-*
 *   team.team_projects.id          seedtp-*
 *   team.teams.id                  seedprojteam-*
 *   user.developer_profiles.id     seedprojprof-*
 *   collab.collab_posts            no text id to prefix — see below
 *
 * Re-running wipes the previous batch first, so it is idempotent.
 * Pass `--clean` to only remove.
 *
 *   bun scripts/seed-test-projects.ts
 *   bun scripts/seed-test-projects.ts --clean
 *
 * ── How this stays off real data ────────────────────────────────────────
 *
 * The script **never writes to the `itch` schema** — the scraped corpus is
 * read-only here, and the seeded rows only ever *reference* it by game id.
 *
 * Three narrower guarantees, each of which had a way to go wrong:
 *
 *  1. **Corpus rows can't steal a real game's identity.** The itch-anchored
 *     seeds carry genuine `source_game_id`s (that's what makes the derived
 *     JAM RECORD real), and `projects.source_game_id` is the dedupe key the
 *     library/jam syncs converge on. So a candidate game is skipped when it
 *     already has a project row **or when its entry author is a linked
 *     member account** — without that second filter a member's next sync
 *     would converge their real placement onto a seed project, and the
 *     deseed would then null it out (`ON DELETE SET NULL`), silently
 *     unlinking real data. See `pickGames`.
 *  2. **The deseed refuses to take foreign rows with it.** Before deleting,
 *     it looks for non-seed placements and posts pointing at seed projects.
 *     Those can only exist if a collision slipped past (1) or somebody
 *     linked a seed project by hand on staging; it reports them and the
 *     remedy rather than quietly nulling them.
 *  3. **Seeded collab posts are identified by two things, not one.**
 *     `collab_posts.id` is a serial, so there is no prefix to match on. The
 *     clean pass takes only posts that both link a seed project/team *and*
 *     carry the seeded description marker — so a genuine staging post that
 *     happens to link a seed project survives (it degrades to its free-text
 *     `projectName`, exactly as the schema intends). Every seeded post
 *     therefore links a seed entity; none is left unlinked, or it would be
 *     unreachable by the clean pass.
 *
 * ⚠ Still deseed before running the Part 7 bulk backfill: the seeds hold
 * their `source_game_id` slots while they exist, so the backfill would skip
 * those games.
 */
import { faker } from "@faker-js/faker";
import { and, count, desc, eq, inArray, isNotNull, isNull, like, not, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  collabPostRoles,
  collabPostSkills,
  collabPosts,
  collabRoles,
  developerProfiles,
  itchJamEntries,
  itchJams,
  linkedAccounts,
  profileProjects,
  projectContributors,
  projectJamLinks,
  projectTeams,
  projects,
  skills,
  teamMembers,
  teamProjects,
  teams,
  user,
} from "@/db/schema";

const CLEAN_ONLY = process.argv.includes("--clean");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

// The bulk half generates its rows; a fixed seed keeps re-runs identical.
faker.seed(1337);

// ── Wipe any previous batch ──────────────────────────────────────────────────

/** The marker every seeded post's description opens with (see guarantee 3). */
const POST_MARKER = "Seeded test post.";

// The ids we're about to remove, read before anything is deleted: the
// collab-post pass needs them, and `ON DELETE SET NULL` on both link columns
// means deleting projects/teams *first* would strand those posts with
// nothing left to identify them by.
const previous = await db
  .select({ id: projects.id })
  .from(projects)
  .where(like(projects.id, "seedproj-%"));
const previousProjectIds = previous.map((p) => p.id);
const previousTeamIds = (
  await db.select({ id: teams.id }).from(teams).where(like(teams.id, "seedprojteam-%"))
).map((t) => t.id);

// Guarantee 2: anything *not* ours pointing at a seed project. A collision
// here means a real row is about to be silently unlinked, so it's reported
// rather than absorbed — the backfill re-mints and re-links these games.
if (previousProjectIds.length > 0) {
  const [placements, teamPlacements, posts] = await Promise.all([
    db
      .select({ n: count() })
      .from(profileProjects)
      .where(
        and(
          inArray(profileProjects.projectId, previousProjectIds),
          not(like(profileProjects.id, "seedpp-%")),
        ),
      )
      .then((rows) => Number(rows[0]?.n ?? 0)),
    db
      .select({ n: count() })
      .from(teamProjects)
      .where(
        and(
          inArray(teamProjects.projectId, previousProjectIds),
          not(like(teamProjects.id, "seedtp-%")),
        ),
      )
      .then((rows) => Number(rows[0]?.n ?? 0)),
    db
      .select({ n: count() })
      .from(collabPosts)
      .where(
        and(
          inArray(collabPosts.projectId, previousProjectIds),
          not(like(collabPosts.description, `${POST_MARKER}%`)),
        ),
      )
      .then((rows) => Number(rows[0]?.n ?? 0)),
  ]);
  const total = placements + teamPlacements + posts;
  if (total > 0) {
    console.warn(
      `\n⚠ ${total} real row(s) point at a seed project and will be unlinked (not deleted):\n` +
        `    profile placements ${placements}, team placements ${teamPlacements}, collab posts ${posts}\n` +
        `  A sync converged real data onto a seed row's game id. After this run:\n` +
        `    bun run railway:backfill:projects   # re-mints those games and re-links them\n`,
    );
  }
}

// Seeded posts first — both link columns are ON DELETE SET NULL, so once the
// projects and teams are gone there is no way left to find them. Scoped to
// rows that carry the marker *and* link a seed entity, so a genuine staging
// post that picked a seed project keeps its life and merely degrades.
if (previousProjectIds.length > 0 || previousTeamIds.length > 0) {
  const linkedToSeed = [
    ...(previousProjectIds.length > 0 ? [inArray(collabPosts.projectId, previousProjectIds)] : []),
    ...(previousTeamIds.length > 0 ? [inArray(collabPosts.teamId, previousTeamIds)] : []),
  ];
  // Roles, skills, responses, images and reports all cascade from the post.
  const removedPosts = await db
    .delete(collabPosts)
    .where(and(like(collabPosts.description, `${POST_MARKER}%`), or(...linkedToSeed)))
    .returning({ id: collabPosts.id });
  if (removedPosts.length > 0) console.log(`cleaned ${removedPosts.length} seeded collab posts`);
}

// Placements next (their project_id would be nulled by the project delete
// anyway, but they're seed rows themselves); the project delete cascades
// credits, team claims and jam links.
await db.delete(profileProjects).where(like(profileProjects.id, "seedpp-%"));
await db.delete(teamProjects).where(like(teamProjects.id, "seedtp-%"));
if (previousProjectIds.length > 0) {
  await db.delete(projects).where(inArray(projects.id, previousProjectIds));
}
await db.delete(teams).where(like(teams.id, "seedprojteam-%"));
await db.delete(developerProfiles).where(like(developerProfiles.id, "seedprojprof-%"));
console.log(`cleaned ${previous.length} seeded projects (+ placements, teams, profiles)`);
if (CLEAN_ONLY) process.exit(0);

// ── Anchors that must already exist ──────────────────────────────────────────

// `projects.created_by` and `team_projects.added_by` are FKs into the auth
// user table, so the batch hangs off a real account — same rule as the
// teams seed. Synthetic profiles are fine everywhere that points at
// `developer_profiles` (credits, placements, rosters).
const users = await db.select({ id: user.id, name: user.name }).from(user);
const owner = users.find((u) => u.name === "Joshe") ?? users[0];
if (!owner) throw new Error("no auth user on this environment to own the seeded projects");

// Real scraped anchors, picked at runtime so the derived jam record and the
// restricted/scrape-mint shapes run against genuine data. All optional: on
// an environment with no scraped corpus the script seeds the manual half
// and says so.
// Itch user ids belonging to members who have linked an account here. A game
// uploaded by one of them is a game their next library/jam sync will try to
// converge — onto whatever project row holds that `source_game_id`. If that
// row is a seed, their real placement links to it and the deseed nulls it
// out. So those games are off-limits to the seed entirely (guarantee 1).
const linkedItchAuthorIds = new Set(
  (
    await db
      .select({ providerUserId: linkedAccounts.providerUserId })
      .from(linkedAccounts)
      .where(eq(linkedAccounts.provider, "itchio"))
  )
    .map((row) => Number(row.providerUserId))
    .filter((id) => Number.isFinite(id)),
);

/**
 * Unminted corpus games with the requested jam spread.
 *
 * The "not already minted" test is a **join, not a post-filter**: since the
 * Part 7 bulk backfill ran, all but a handful of the corpus already has
 * project rows (21,184 of 21,156 multi-jam games at the time of writing), so
 * filtering a `LIMIT`ed sample in JS threw away every candidate and the
 * anchored rows silently stopped seeding. Filtering in SQL means the limit
 * applies to rows that are already eligible.
 */
async function pickGames(multiJam: boolean, wanted: number): Promise<number[]> {
  const candidates = await db
    .select({
      gameId: itchJamEntries.gameId,
      // Any author id for the game; entries for one game share an uploader.
      authorId: sql<number | null>`min(${itchJamEntries.authorId})`,
    })
    .from(itchJamEntries)
    // 1:1 by the partial unique index on `source_game_id`, so the join can't
    // multiply rows and the DISTINCT jam count below stays honest.
    .leftJoin(projects, eq(projects.sourceGameId, itchJamEntries.gameId))
    .where(and(isNull(itchJamEntries.missingSince), isNull(projects.id)))
    .groupBy(itchJamEntries.gameId)
    .having(
      multiJam
        ? sql`count(DISTINCT ${itchJamEntries.jamId}) > 1`
        : sql`count(DISTINCT ${itchJamEntries.jamId}) = 1`,
    )
    // Headroom for the author filter below, which rejects very few.
    .limit(wanted * 10);
  return candidates
    .filter((row) => row.authorId == null || !linkedItchAuthorIds.has(row.authorId))
    .map((row) => row.gameId)
    .slice(0, wanted);
}

/** Latest surviving entry per game — the same seed rule the real mints use. */
async function latestEntry(gameId: number) {
  const [entry] = await db
    .select()
    .from(itchJamEntries)
    .where(sql`${itchJamEntries.gameId} = ${gameId} AND ${itchJamEntries.missingSince} IS NULL`)
    .orderBy(sql`${itchJamEntries.submittedAt} DESC NULLS LAST`)
    .limit(1);
  return entry ?? null;
}

// First two multi-jam picks are the curated crossjam/restricted rows; the
// rest anchor the bulk corpus half. Same split for single-jam strangers.
const [multiJamA, multiJamB, ...bulkMultiJam] = await pickGames(true, 12);
const [singleJam, ...bulkSingleJam] = await pickGames(false, 7);
const [realJam] = await db
  .select({ jamId: itchJams.jamId, title: itchJams.title, entriesCount: itchJams.entriesCount })
  .from(itchJams)
  .where(isNull(itchJams.missingSince))
  .orderBy(desc(itchJams.entriesCount))
  .limit(1);

// ── Synthetic members ────────────────────────────────────────────────────────

const people = [
  { key: "marlow", username: "marlow.paints", tagline: "Pixel art, palettes, patience" },
  { key: "petra", username: "petrabyte", tagline: "Gameplay code, Godot + C#" },
  { key: "kit", username: "kithums", tagline: "OST + sound design" },
  { key: "noor", username: "noorwind", tagline: "Does a bit of everything" },
] as const;

await db.insert(developerProfiles).values(
  people.map((p) => ({
    id: `seedprojprof-${p.key}`,
    discordUsername: p.username,
    tagline: p.tagline,
    availableForWork: false,
  })),
);
const prof = (key: (typeof people)[number]["key"]) => `seedprojprof-${key}`;

// ── Teams ────────────────────────────────────────────────────────────────────

// Half Moon Bay includes the real account, so team-claimed projects are
// editable *through the claim* (§1.3's third clause). Driftline does not —
// its claimed project must be read-only for you.
await db.insert(teams).values([
  {
    id: "seedprojteam-halfmoon",
    slug: "half-moon-bay",
    name: "Half Moon Bay",
    tagline: "Seeded: claims Signal Decay; you're a member.",
    recruiting: false,
    createdBy: owner.id,
    lastActivityAt: ago(1),
  },
  {
    id: "seedprojteam-driftline",
    slug: "driftline",
    name: "Driftline",
    tagline: "Seeded: claims Bramble Tileset; you're NOT a member.",
    recruiting: false,
    createdBy: owner.id,
    lastActivityAt: ago(3),
  },
]);
await db.insert(teamMembers).values([
  { teamId: "seedprojteam-halfmoon", userId: owner.id, role: "owner", sortOrder: 0 },
  { teamId: "seedprojteam-halfmoon", userId: prof("marlow"), role: "member", sortOrder: 1 },
  { teamId: "seedprojteam-halfmoon", userId: prof("kit"), role: "member", sortOrder: 2 },
  { teamId: "seedprojteam-driftline", userId: prof("petra"), role: "owner", sortOrder: 0 },
  { teamId: "seedprojteam-driftline", userId: prof("noor"), role: "member", sortOrder: 1 },
]);

// ── Canonical projects (manual half) ─────────────────────────────────────────

type ProjectInsert = typeof projects.$inferInsert;

const manualProjects: ProjectInsert[] = [
  {
    // The kitchen-sink row: every editor surface, both jam-link shapes, a
    // team claim, and the full credits mix.
    id: "seedproj-signal",
    slug: "seed-signal-decay",
    title: "Signal Decay",
    description:
      "Seeded test game. A lighthouse keeper tunes dead frequencies; whatever answers, answers back.",
    type: "game",
    url: "https://example.com/signal-decay",
    links: [
      { label: "REPO", url: "https://github.com/example/signal-decay" },
      { label: "PRESS KIT", url: "https://example.com/signal-decay/press" },
    ],
    source: "manual",
    releaseStatus: "released",
    releasedAt: ago(30),
    createdBy: owner.id,
  },
  {
    id: "seedproj-dither",
    slug: "seed-dither-forge",
    title: "Dither Forge",
    description: "Seeded test tool. Palette-constrained dithering for pixel artists.",
    type: "tool",
    url: "https://example.com/dither-forge",
    links: [{ label: "REPO", url: "https://github.com/example/dither-forge" }],
    source: "manual",
    releaseStatus: "in_development",
    createdBy: owner.id,
  },
  {
    // createdBy null + credits linked only to seed profiles + a claim by a
    // team you're not in ⇒ you can't edit this one. That's the point.
    id: "seedproj-bramble",
    slug: "seed-bramble-tileset",
    title: "Bramble Tileset",
    description: "Seeded asset pack. 16×16 hedgerow autotiles, 4 seasons.",
    type: "assets",
    url: "https://example.com/bramble",
    source: "manual",
    releaseStatus: "released",
    releasedAt: ago(90),
    createdBy: null,
  },
  {
    id: "seedproj-nightloops",
    slug: "seed-night-loops",
    title: "Night Loops OST",
    description: "Seeded soundtrack. Ten tracks of 2am synth.",
    type: "audio",
    subTypes: ["music"],
    url: "https://example.com/night-loops",
    source: "manual",
    releaseStatus: "released",
    releasedAt: ago(60),
    createdBy: owner.id,
  },
  {
    id: "seedproj-jamtimer",
    slug: "seed-jamtimer",
    title: "JamTimer",
    description: "Seeded app. Countdown + milestone pings for jam weekends.",
    type: "app",
    subTypes: ["web", "mobile"],
    url: "https://example.com/jamtimer",
    source: "manual",
    releaseStatus: "prototype",
    createdBy: owner.id,
  },
  {
    id: "seedproj-paperwing",
    slug: "seed-paperwing-site",
    title: "paperwing.dev",
    description: "Seeded website. Devlog and portfolio site, the artifact itself.",
    type: "web",
    url: "https://example.com/paperwing",
    links: [{ label: "SOURCE", url: "https://github.com/example/paperwing" }],
    source: "manual",
    releaseStatus: "in_development",
    createdBy: owner.id,
  },
  {
    // No placement, no team, no linked contributor, no createdBy — an
    // orphan the sweep must KEEP (free-text credits) and a page that
    // should carry `noindex` (published but unanchored).
    id: "seedproj-zine",
    slug: "seed-paper-zine",
    title: "Paper Zine Vol. 1",
    description: "Seeded 'other' artifact. A riso-printed jam retrospective zine.",
    type: "other",
    source: "manual",
    releasedAt: ago(200),
    createdBy: null,
  },
  {
    // Unpublished: 404 for everyone but its editors, `noindex` for them.
    id: "seedproj-secret",
    slug: "seed-secret-prototype",
    title: "Secret Prototype",
    description: "Seeded unpublished project — only its editors should ever see this page.",
    type: "game",
    source: "manual",
    published: false,
    createdBy: owner.id,
  },
  {
    // The post-step-6 manual jam participation: the jam facts live ONLY on
    // project_jam_links; the placement below carries none of them.
    id: "seedproj-mothlight",
    slug: "seed-moth-light",
    title: "Moth Light",
    description: "Seeded jam entry for an off-itch jam.",
    type: "game",
    source: "manual",
    releasedAt: ago(45),
    createdBy: owner.id,
  },
];

await db.insert(projects).values(manualProjects);

// ── Canonical projects (real-corpus half) ────────────────────────────────────

let corpusNote = "no scraped corpus on this environment — skipped the itch-anchored rows";
const corpusTitles: Record<string, string> = {};
if (multiJamA != null && realJam) {
  const entryA = await latestEntry(multiJamA);
  const entryB = multiJamB != null ? await latestEntry(multiJamB) : null;
  const entryS = singleJam != null ? await latestEntry(singleJam) : null;

  const corpusProjects: ProjectInsert[] = [];
  if (entryA) {
    corpusTitles.crossjam = entryA.gameTitle;
    corpusProjects.push({
      // Anchored multi-jam import: the derived JAM RECORD should show every
      // scraped appearance with ranks, and the page should be indexable.
      id: "seedproj-crossjam",
      slug: "seed-crossjam",
      title: entryA.gameTitle,
      description: entryA.gameShortText,
      type: "game",
      url: entryA.gameUrl,
      imageUrl: entryA.gameCoverUrl,
      source: "itchio",
      sourceGameId: multiJamA,
      releasedAt: entryA.submittedAt,
      createdBy: owner.id,
    });
  }
  if (entryB && multiJamB != null) {
    corpusTitles.restricted = entryB.gameTitle;
    corpusProjects.push({
      // Restricted: the page renders (participation is public record) but
      // suppresses its itch links.
      id: "seedproj-restricted",
      slug: "seed-restricted",
      title: entryB.gameTitle,
      description: entryB.gameShortText,
      type: "game",
      url: entryB.gameUrl,
      imageUrl: entryB.gameCoverUrl,
      source: "itchio",
      sourceGameId: multiJamB,
      restrictedAt: ago(5),
      releasedAt: entryB.submittedAt,
      createdBy: owner.id,
    });
  }
  if (entryS && singleJam != null) {
    corpusTitles.strangers = entryS.gameTitle;
    corpusProjects.push({
      // The lazy-mint shape: single-jam, nothing local anchors it, nobody
      // can edit it, and its page carries `noindex`.
      id: "seedproj-strangers",
      slug: "seed-strangers-game",
      title: entryS.gameTitle,
      description: entryS.gameShortText,
      type: "game",
      url: entryS.gameUrl,
      imageUrl: entryS.gameCoverUrl,
      source: "itchio",
      sourceGameId: singleJam,
      releasedAt: entryS.submittedAt,
      createdBy: null,
    });
  }
  if (corpusProjects.length > 0) {
    await db.insert(projects).values(corpusProjects);
    corpusNote = `itch-anchored rows: crossjam=${multiJamA} (${corpusTitles.crossjam}), restricted=${multiJamB}, strangers=${singleJam}`;
  }

  // Scrape-shaped credits for the strangers row, exactly as the mint paths
  // write them: free-text `entry-contributors`, no profile link.
  if (entryS) {
    const names = entryS.contributors
      .map((c) => c.name?.trim())
      .filter((name): name is string => !!name);
    if (names.length > 0) {
      await db.insert(projectContributors).values(
        names.map((displayName, i) => ({
          projectId: "seedproj-strangers",
          displayName,
          source: "entry-contributors",
          sortOrder: i,
        })),
      );
    }
  }
}

/**
 * Which canonical rows actually landed. The corpus half is conditional — an
 * environment with no scraped entries seeds only the manual rows — so the
 * collab posts further down check before linking one.
 */
const seededProjectIds = new Set(
  (await db.select({ id: projects.id }).from(projects).where(like(projects.id, "seedproj-%"))).map(
    (row) => row.id,
  ),
);

// ── Credits ──────────────────────────────────────────────────────────────────

await db.insert(projectContributors).values([
  // Signal Decay: the full mix — you, two linked members, a free-text guest,
  // and a scraped-source row (editable like any other).
  {
    projectId: "seedproj-signal",
    profileId: owner.id,
    displayName: owner.name ?? "You",
    role: "Code & design",
    source: "placement",
    sortOrder: 0,
  },
  {
    projectId: "seedproj-signal",
    profileId: prof("marlow"),
    displayName: "marlow.paints",
    role: "Pixel art",
    source: "manual",
    sortOrder: 1,
  },
  {
    projectId: "seedproj-signal",
    profileId: prof("kit"),
    displayName: "kithums",
    role: "Music",
    source: "manual",
    sortOrder: 2,
  },
  {
    projectId: "seedproj-signal",
    displayName: "guest-animator",
    role: "Animation",
    source: "entry-contributors",
    sortOrder: 3,
  },
  // Dither Forge: just you.
  {
    projectId: "seedproj-dither",
    profileId: owner.id,
    displayName: owner.name ?? "You",
    source: "placement",
    sortOrder: 0,
  },
  // Bramble: linked to seed profiles only — you're not in this editor set.
  {
    projectId: "seedproj-bramble",
    profileId: prof("marlow"),
    displayName: "marlow.paints",
    role: "Everything",
    source: "placement",
    sortOrder: 0,
  },
  // Night Loops: composer + you.
  {
    projectId: "seedproj-nightloops",
    profileId: prof("kit"),
    displayName: "kithums",
    role: "Composer",
    source: "placement",
    sortOrder: 0,
  },
  {
    projectId: "seedproj-nightloops",
    profileId: owner.id,
    displayName: owner.name ?? "You",
    role: "Mastering",
    source: "manual",
    sortOrder: 1,
  },
  {
    projectId: "seedproj-jamtimer",
    profileId: owner.id,
    displayName: owner.name ?? "You",
    source: "placement",
    sortOrder: 0,
  },
  {
    projectId: "seedproj-paperwing",
    profileId: owner.id,
    displayName: owner.name ?? "You",
    source: "placement",
    sortOrder: 0,
  },
  // Zine: free-text only, which is what keeps it an orphan-to-KEEP.
  {
    projectId: "seedproj-zine",
    displayName: "riso club",
    role: "Print",
    source: "manual",
    sortOrder: 0,
  },
  {
    projectId: "seedproj-zine",
    displayName: "noor (uncredited account)",
    role: "Layout",
    source: "manual",
    sortOrder: 1,
  },
  {
    projectId: "seedproj-secret",
    profileId: owner.id,
    displayName: owner.name ?? "You",
    source: "placement",
    sortOrder: 0,
  },
  {
    projectId: "seedproj-mothlight",
    profileId: owner.id,
    displayName: owner.name ?? "You",
    source: "placement",
    sortOrder: 0,
  },
  {
    projectId: "seedproj-mothlight",
    profileId: prof("noor"),
    displayName: "noorwind",
    role: "Co-jam",
    source: "manual",
    sortOrder: 1,
  },
  // Crossjam credit, only when the corpus row exists.
  ...(multiJamA != null
    ? [
        {
          projectId: "seedproj-crossjam",
          profileId: owner.id,
          displayName: owner.name ?? "You",
          source: "placement",
          sortOrder: 0,
        },
      ]
    : []),
]);

// ── Team claims ──────────────────────────────────────────────────────────────

await db.insert(projectTeams).values([
  { projectId: "seedproj-signal", teamId: "seedprojteam-halfmoon" },
  { projectId: "seedproj-bramble", teamId: "seedprojteam-driftline" },
]);

// ── Explicit jam records ─────────────────────────────────────────────────────

await db.insert(projectJamLinks).values([
  // FK-linked to a real scraped jam (links to its /jams page) …
  ...(realJam
    ? [
        {
          projectId: "seedproj-signal",
          jamId: realJam.jamId,
          result: `Overall: #12 of ${realJam.entriesCount ?? 300}`,
          submissionUrl: "https://example.itch.io/signal-decay",
          participatedAt: ago(30),
        },
      ]
    : []),
  // …and a free-text off-itch jam on the same project.
  {
    projectId: "seedproj-signal",
    jamName: "Foghorn 48 (off-itch)",
    jamUrl: "https://example.com/foghorn48",
    result: "Finalist",
    participatedAt: ago(160),
  },
  // Moth Light's only jam facts live here — its placement carries none
  // (the post-step-6 shape the reads must coalesce from).
  {
    projectId: "seedproj-mothlight",
    jamName: "Frostbite Off-Itch Jam 2025",
    jamUrl: "https://example.com/frostbite-jam",
    result: "1st in Mood",
    participatedAt: ago(45),
  },
]);

// ── Profile placements (yours) ───────────────────────────────────────────────

await db
  .insert(profileProjects)
  .values([
    {
      id: "seedpp-signal",
      profileId: owner.id,
      projectId: "seedproj-signal",
      type: "game",
      title: "Signal Decay",
      description: "Seeded test game.",
      url: "https://example.com/signal-decay",
      pinned: true,
      status: "approved",
      source: "manual",
    },
    {
      id: "seedpp-dither",
      profileId: owner.id,
      projectId: "seedproj-dither",
      type: "tool",
      title: "Dither Forge",
      status: "approved",
      source: "manual",
    },
    {
      id: "seedpp-nightloops",
      profileId: owner.id,
      projectId: "seedproj-nightloops",
      type: "audio",
      subTypes: ["music"],
      title: "Night Loops OST",
      status: "approved",
      source: "manual",
    },
    {
      // Placement enum can't hold `app→web` nuance beyond subTypes; the
      // canonical row is what the card label should prefer.
      id: "seedpp-jamtimer",
      profileId: owner.id,
      projectId: "seedproj-jamtimer",
      type: "app",
      subTypes: ["web", "mobile"],
      title: "JamTimer",
      status: "approved",
      source: "manual",
    },
    {
      // `web` kind stores as the enum's `app` — the profile card should
      // still read WEBSITE via canonicalType.
      id: "seedpp-paperwing",
      profileId: owner.id,
      projectId: "seedproj-paperwing",
      type: "app",
      title: "paperwing.dev",
      status: "approved",
      source: "manual",
    },
    {
      id: "seedpp-secret",
      profileId: owner.id,
      projectId: "seedproj-secret",
      type: "game",
      title: "Secret Prototype",
      status: "approved",
      published: false,
      source: "manual",
    },
    {
      // Post-step-6 jam participation: NO jamName/jamUrl/result/teamMembers
      // here — the jam log must coalesce them from project_jam_links.
      id: "seedpp-mothlight",
      profileId: owner.id,
      projectId: "seedproj-mothlight",
      type: "jam",
      title: "Moth Light",
      submissionTitle: "Moth Light",
      submissionUrl: "https://example.com/moth-light",
      participatedAt: ago(45),
      status: "approved",
      source: "manual",
    },
    {
      // Legacy jam participation: free-text columns populated, no canonical
      // row — the old read path, which must keep working untouched.
      id: "seedpp-legacyjam",
      profileId: owner.id,
      type: "jam",
      title: "Rust Belt Racer",
      jamName: "Legacy Winter Jam 2024",
      jamUrl: "https://example.com/legacy-winter-jam",
      submissionTitle: "Rust Belt Racer",
      result: "7th overall",
      teamMembers: ["old friend", "other pal"],
      participatedAt: ago(500),
      status: "approved",
      source: "manual",
    },
    // Marlow showcases Bramble on their own profile.
    {
      id: "seedpp-bramble-marlow",
      profileId: prof("marlow"),
      projectId: "seedproj-bramble",
      type: "tool",
      title: "Bramble Tileset",
      status: "approved",
      source: "manual",
    },
    ...(multiJamA != null
      ? [
          {
            // Imported library placement for the multi-jam game, the shape
            // the itch sync writes.
            id: "seedpp-crossjam",
            profileId: owner.id,
            projectId: "seedproj-crossjam",
            type: "game" as const,
            title: corpusTitles.crossjam ?? "Cross-jam import",
            status: "approved",
            source: "itchio" as const,
            sourceId: String(multiJamA),
          },
        ]
      : []),
    ...(multiJamB != null
      ? [
          {
            id: "seedpp-restricted",
            profileId: owner.id,
            projectId: "seedproj-restricted",
            type: "game" as const,
            title: corpusTitles.restricted ?? "Restricted import",
            status: "approved",
            source: "itchio" as const,
            sourceId: String(multiJamB),
            restrictedAt: ago(5),
          },
        ]
      : []),
  ])
  // The per-profile source unique index: if a real import of the same game
  // already exists on this account, skip ours rather than failing the run.
  .onConflictDoNothing();

// ── Team placements ──────────────────────────────────────────────────────────

await db.insert(teamProjects).values([
  {
    // Placement-only import shape: the title is a deliberately STALE
    // snapshot — the showcase must render "Signal Decay" from the
    // canonical row, not this.
    id: "seedtp-halfmoon-signal",
    teamId: "seedprojteam-halfmoon",
    projectId: "seedproj-signal",
    type: "game",
    title: "STALE SNAPSHOT — should not render",
    source: "manual",
    sourceProfileProjectId: "seedpp-signal",
    addedBy: owner.id,
  },
  {
    // Legacy team row: free-text jam facts on the placement itself, no
    // canonical link — the old coalesce path.
    id: "seedtp-halfmoon-legacy",
    teamId: "seedprojteam-halfmoon",
    projectId: null,
    type: "jam",
    title: "Harbor Watch (legacy row)",
    jamName: "Legacy Team Jam 2023",
    jamUrl: "https://example.com/legacy-team-jam",
    result: "Finalist",
    participatedAt: ago(600),
    addedBy: owner.id,
    source: "manual",
  },
  {
    id: "seedtp-driftline-bramble",
    teamId: "seedprojteam-driftline",
    projectId: "seedproj-bramble",
    type: "tool",
    title: "Bramble Tileset",
    addedBy: owner.id,
    source: "manual",
  },
]);

// ── Collab posts (Part 8: recruiting for a project) ──────────────────────────
//
// Every post here links a seed project or a seed team — that link plus the
// description marker is what the clean pass matches on, so an unlinked post
// would be unreachable by it. `author_id` is the real account (an FK into
// auth `user`, same rule as `projects.created_by`).

const roleRows = await db.select({ id: collabRoles.id, name: collabRoles.name }).from(collabRoles);
const skillRows = await db.select({ id: skills.id, name: skills.name }).from(skills);
const roleId = (name: string) =>
  roleRows.find((r) => r.name.toLowerCase() === name.toLowerCase())?.id;
const skillId = (name: string) =>
  skillRows.find((s) => s.name.toLowerCase() === name.toLowerCase())?.id;

type SeedPost = {
  key: string;
  projectId: string | null;
  teamId: string | null;
  isIndividual?: boolean;
  jamId?: number | null;
  type: "paid" | "hobby";
  title: string;
  /** Appended to POST_MARKER — the marker is what makes the row removable. */
  blurb: string;
  projectName: string;
  platforms: string[];
  status?: "recruiting" | "party_full" | "expired";
  /** Days from now; negative is already past (the sweep should catch it). */
  expiresInDays?: number;
  roles: string[];
  skills?: string[];
};

const seedPosts: SeedPost[] = [
  {
    // The mainline: team + project both linked, which is what the picker
    // produces from the PROJECT step after a team is chosen.
    key: "signal-artist",
    projectId: "seedproj-signal",
    teamId: "seedprojteam-halfmoon",
    type: "paid",
    title: "Pixel artist for Signal Decay's second act",
    blurb:
      " Team and project both linked — the shape the wizard's picker produces. Environment tiles and a lighthouse interior, roughly six weeks.",
    projectName: "Signal Decay",
    platforms: ["PC", "Mac"],
    expiresInDays: 30,
    roles: ["Pixel Artist", "2D Artist", "Artist"],
    skills: ["Aseprite", "Godot"],
  },
  {
    // Second open post on the same project, so the project page's RECRUITING
    // blurb renders its plural and the count is a real aggregate.
    key: "signal-audio",
    projectId: "seedproj-signal",
    teamId: "seedprojteam-halfmoon",
    type: "hobby",
    title: "Sound designer for Signal Decay",
    blurb:
      " Second open post on the same project, so the RECRUITING section has a plural to render. Radio static, room tone, and a handful of stingers.",
    projectName: "Signal Decay",
    platforms: ["PC"],
    // Inside the sweep's 3-day nudge window: exercises CLOSES IN + EXTEND.
    expiresInDays: 2,
    roles: ["Sound Designer", "Composer", "Audio"],
    skills: ["FMOD", "REAPER"],
  },
  {
    // Closed, and still linked: the project page must count recruiting posts
    // only, so this one must NOT move its number.
    key: "signal-closed",
    projectId: "seedproj-signal",
    teamId: "seedprojteam-halfmoon",
    type: "hobby",
    title: "Writer for Signal Decay (filled)",
    blurb:
      " Closed post on a project that still has open ones — the RECRUITING count must ignore this row entirely.",
    projectName: "Signal Decay",
    platforms: ["PC"],
    status: "party_full",
    expiresInDays: 20,
    roles: ["Writer", "Narrative Designer", "Designer"],
  },
  {
    // §8.2's deliberate asymmetry: a team post with no project at all. The
    // picker must stay skippable, and the card must read fine without one.
    key: "preproject",
    projectId: null,
    teamId: "seedprojteam-halfmoon",
    type: "hobby",
    title: "Crew for whatever we build next jam",
    blurb:
      " A pre-project post: team linked, project deliberately empty. This is the case that keeps the project picker optional.",
    projectName: "Untitled jam game",
    platforms: ["PC", "Web"],
    expiresInDays: 40,
    roles: ["Programmer", "Developer", "Game Developer"],
    skills: ["Godot"],
  },
  {
    // Solo + project: no team, so the post proves projectId is independent
    // of teamId rather than riding along with it.
    key: "solo-dither",
    projectId: "seedproj-dither",
    teamId: null,
    isIndividual: true,
    type: "paid",
    title: "Rust dev to help finish Dither Forge",
    blurb:
      " Solo post that still links a project — project linkage is independent of team linkage, and this is the row that proves it.",
    projectName: "Dither Forge",
    platforms: ["PC", "Mac", "Linux"],
    expiresInDays: 25,
    roles: ["Programmer", "Developer", "Tools Programmer"],
    skills: ["Rust"],
  },
  {
    // Recruiting for something not yet public. `listEditableProjects`
    // includes unpublished rows on purpose; this is what that's for.
    key: "secret",
    projectId: "seedproj-secret",
    teamId: "seedprojteam-halfmoon",
    type: "hobby",
    title: "Playtesters for an unannounced prototype",
    blurb:
      " Linked to an UNPUBLISHED project — recruiting for a thing that isn't public yet is the normal case, not an edge one.",
    projectName: "Secret Prototype",
    platforms: ["PC"],
    expiresInDays: 15,
    roles: ["Designer", "Game Designer", "Producer"],
  },
];

for (const post of seedPosts) {
  // Skip a row whose project didn't get seeded (the corpus half is optional).
  if (post.projectId != null && !seededProjectIds.has(post.projectId)) continue;

  const [row] = await db
    .insert(collabPosts)
    .values({
      authorId: owner.id,
      projectId: post.projectId,
      teamId: post.teamId,
      jamId: post.jamId ?? null,
      isIndividual: post.isIndividual ?? false,
      type: post.type,
      title: post.title,
      description: POST_MARKER + post.blurb,
      projectName: post.projectName,
      platforms: post.platforms,
      projectLength: "1-3 months",
      experienceLevel: "intermediate",
      compensationType: post.type === "paid" ? "negotiable" : null,
      contactType: post.isIndividual ? null : "discord_server",
      contactMethod: post.isIndividual ? null : "discord.gg/seeded-example",
      status: post.status ?? "recruiting",
      expiresAt: new Date(Date.now() + (post.expiresInDays ?? 30) * DAY),
      createdAt: ago(3),
      updatedAt: ago(3),
    })
    .returning({ id: collabPosts.id });

  // The curated role vocabulary varies by environment, so each post lists
  // several acceptable names and takes the first that exists — a post with
  // no roles can't be edited through the wizard (it requires at least one).
  const resolvedRole = post.roles.map(roleId).find((id) => id != null);
  if (resolvedRole != null) {
    await db.insert(collabPostRoles).values({ postId: row.id, roleId: resolvedRole });
  }
  const resolvedSkills = (post.skills ?? []).map(skillId).filter((id): id is number => id != null);
  if (resolvedSkills.length > 0) {
    await db
      .insert(collabPostSkills)
      .values(resolvedSkills.map((id) => ({ postId: row.id, skillId: id })));
  }
}

// ── Bulk volume ──────────────────────────────────────────────────────────────
//
// Everything above is the curated checklist — one row per behaviour. This
// half is volume, so grids, shelves and logs render at realistic size:
// more members, more teams, ~50 more manual projects, ten more anchored
// corpus games, six more strangers, and enough placements to fill the
// busiest jam's community shelf. Deterministic via the seeded faker.

const KINDS = [
  "game",
  "game",
  "game",
  "game",
  "tool",
  "assets",
  "audio",
  "app",
  "web",
  "other",
] as const;
const PLACEMENT_TYPE: Record<string, "game" | "tool" | "audio" | "app"> = {
  game: "game",
  tool: "tool",
  assets: "tool",
  audio: "audio",
  app: "app",
  web: "app",
  other: "game",
};
const STATUSES = [
  "released",
  "released",
  "released",
  "in_development",
  "prototype",
  "on_hold",
  "canceled",
] as const;
const ROLES = [
  "Code",
  "Pixel art",
  "3D art",
  "Music",
  "SFX",
  "Design",
  "Writing",
  "Production",
  "UI",
  "Shaders",
];

const fakeTitle = () =>
  `${faker.word.adjective()} ${faker.word.noun()}`.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Eight more members, so rosters and credits have spread.
const bulkProfiles = Array.from({ length: 8 }, (_, i) => ({
  id: `seedprojprof-bulk${i}`,
  discordUsername: `${faker.word.noun()}_${faker.number.int({ min: 10, max: 99 })}`,
  tagline: faker.company.catchPhrase(),
  availableForWork: i % 3 === 0,
}));
await db.insert(developerProfiles).values(bulkProfiles);

const allProfileIds = [...people.map((p) => prof(p.key)), ...bulkProfiles.map((p) => p.id)];
const usernameById = new Map<string, string>([
  ...people.map((p) => [prof(p.key), p.username] as const),
  ...bulkProfiles.map((p) => [p.id, p.discordUsername] as const),
]);

// Four more teams with rosters drawn from the whole member pool.
const bulkTeams = Array.from({ length: 4 }, (_, i) => ({
  id: `seedprojteam-bulk${i}`,
  slug: `seed-${slugify(fakeTitle())}-${i}`,
  name: `${fakeTitle()} ${faker.helpers.arrayElement(["Studio", "Crew", "Collective", "Club", "Works"])}`,
  tagline: faker.company.catchPhrase(),
  recruiting: i % 2 === 0,
  createdBy: owner.id,
  lastActivityAt: ago(i * 4 + 2),
}));
await db.insert(teams).values(bulkTeams);
await db.insert(teamMembers).values(
  bulkTeams.flatMap((team, i) => {
    const size = 3 + (i % 3);
    return Array.from({ length: size }, (_, j) => ({
      teamId: team.id,
      userId: allProfileIds[(i * 5 + j) % allProfileIds.length],
      role: j === 0 ? "owner" : "member",
      sortOrder: j,
    }));
  }),
);
const allTeamIds = [
  "seedprojteam-halfmoon",
  "seedprojteam-driftline",
  ...bulkTeams.map((t) => t.id),
];

// ~50 generated manual projects across every kind and status.
const bulkManual = Array.from({ length: 48 }, (_, i) => {
  const kind = KINDS[i % KINDS.length];
  const t = kind === "web" ? `${slugify(fakeTitle())}.dev` : fakeTitle();
  return {
    id: `seedproj-bulk${i}`,
    slug: `seed-b${i}-${slugify(t)}`,
    title: t,
    description: faker.lorem.sentence(),
    type: kind,
    subTypes:
      kind === "audio" ? (i % 2 ? ["music"] : ["music", "sfx"]) : kind === "app" ? ["web"] : [],
    url: `https://example.com/${slugify(t)}`,
    links: i % 3 === 0 ? [{ label: "REPO", url: `https://github.com/example/${slugify(t)}` }] : [],
    source: "manual" as const,
    releaseStatus: STATUSES[i % STATUSES.length],
    releasedAt: i % 4 === 0 ? null : ago(10 + i * 7),
    published: i % 16 !== 15,
    createdBy: i % 5 === 0 ? owner.id : null,
  };
});
await db.insert(projects).values(bulkManual);

const bulkCredits: (typeof projectContributors.$inferInsert)[] = [];
const bulkClaims: (typeof projectTeams.$inferInsert)[] = [];
const bulkTeamPlacements: (typeof teamProjects.$inferInsert)[] = [];
const bulkPlacements: (typeof profileProjects.$inferInsert)[] = [];
const bulkJamLinks: (typeof projectJamLinks.$inferInsert)[] = [];

bulkManual.forEach((p, i) => {
  // 1–3 linked credits plus 0–2 free-text ones.
  const start = i % allProfileIds.length;
  const linkedCount = 1 + (i % 3);
  for (let j = 0; j < linkedCount; j++) {
    const profileId = allProfileIds[(start + j) % allProfileIds.length];
    bulkCredits.push({
      projectId: p.id,
      profileId,
      displayName: usernameById.get(profileId) ?? "member",
      role: ROLES[(i + j) % ROLES.length],
      source: j === 0 ? "placement" : "manual",
      sortOrder: j,
    });
  }
  for (let j = 0; j < (i % 4 === 0 ? 2 : i % 2); j++) {
    bulkCredits.push({
      projectId: p.id,
      displayName: faker.person.fullName(),
      role: ROLES[(i + j + 5) % ROLES.length],
      source: "manual",
      sortOrder: linkedCount + j,
    });
  }

  // Every third project is claimed by a team, with a placement-only tile.
  if (i % 3 === 0) {
    const teamId = allTeamIds[i % allTeamIds.length];
    bulkClaims.push({ projectId: p.id, teamId });
    bulkTeamPlacements.push({
      id: `seedtp-bulk${i}`,
      teamId,
      projectId: p.id,
      type: PLACEMENT_TYPE[p.type] ?? "game",
      title: p.title,
      sortOrder: i,
      addedBy: owner.id,
      source: "manual",
    });
  }

  // Every project sits on someone's profile; every fifth on yours.
  bulkPlacements.push({
    id: `seedpp-bulk${i}`,
    profileId: i % 5 === 0 ? owner.id : allProfileIds[start],
    projectId: p.id,
    type: PLACEMENT_TYPE[p.type] ?? "game",
    title: p.title,
    status: "approved",
    published: p.published,
    pinned: i % 12 === 0,
    sortOrder: i,
    source: "manual",
  });

  // A sprinkling of jam records: free-text mostly, some on the real jam.
  if (i % 4 === 1) {
    bulkJamLinks.push({
      projectId: p.id,
      jamName: `${fakeTitle()} Jam ${2020 + (i % 6)}`,
      result: i % 2 ? `#${1 + (i % 20)} overall` : null,
      participatedAt: ago(30 + i * 5),
    });
  }
  if (realJam && i % 8 === 2) {
    bulkJamLinks.push({
      projectId: p.id,
      jamId: realJam.jamId,
      result: `Overall: #${3 + i} of ${realJam.entriesCount ?? 500}`,
      participatedAt: ago(20),
    });
  }
});

// The mega-credits page: stress the CREDITS grid on the first bulk row.
for (let j = 0; j < 12; j++) {
  bulkCredits.push({
    projectId: "seedproj-bulk0",
    displayName: faker.person.fullName(),
    role: ROLES[j % ROLES.length],
    source: "manual",
    sortOrder: 10 + j,
  });
}

// The real jam's community shelf: jam-type placements pointing at it.
if (realJam) {
  for (let i = 0; i < 6; i++) {
    bulkPlacements.push({
      id: `seedpp-jamshelf${i}`,
      profileId: i === 0 ? owner.id : allProfileIds[i],
      type: "jam",
      title: `${fakeTitle()} (jam build)`,
      jamId: realJam.jamId,
      participatedAt: ago(10 + i),
      status: "approved",
      source: "manual",
    });
  }
}

// Ten more anchored corpus games (derived JAM RECORD, spread across the
// member pool) and six more strangers (unanchored, noindex).
let bulkCorpusCount = 0;
for (const [i, gameId] of bulkMultiJam.entries()) {
  const entry = await latestEntry(gameId);
  if (!entry) continue;
  const projectId = `seedproj-anchored${i}`;
  const profileId = allProfileIds[i % allProfileIds.length];
  await db.insert(projects).values({
    id: projectId,
    slug: `seed-a${i}-${slugify(entry.gameTitle) || "game"}`,
    title: entry.gameTitle,
    description: entry.gameShortText,
    type: "game",
    url: entry.gameUrl,
    imageUrl: entry.gameCoverUrl,
    source: "itchio",
    sourceGameId: gameId,
    releasedAt: entry.submittedAt,
    createdBy: null,
  });
  bulkPlacements.push({
    id: `seedpp-anchored${i}`,
    profileId,
    projectId,
    type: "game",
    title: entry.gameTitle,
    status: "approved",
    source: "itchio",
    sourceId: String(gameId),
  });
  bulkCredits.push({
    projectId,
    profileId,
    displayName: usernameById.get(profileId) ?? "member",
    source: "placement",
    sortOrder: 0,
  });
  const seen = new Set<string>();
  entry.contributors.forEach((c, j) => {
    const name = c.name?.trim();
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    bulkCredits.push({
      projectId,
      displayName: name,
      source: "entry-contributors",
      sortOrder: j + 1,
    });
  });
  bulkCorpusCount += 1;
}
for (const [i, gameId] of bulkSingleJam.entries()) {
  const entry = await latestEntry(gameId);
  if (!entry) continue;
  const projectId = `seedproj-stranger${i}`;
  await db.insert(projects).values({
    id: projectId,
    slug: `seed-s${i}-${slugify(entry.gameTitle) || "game"}`,
    title: entry.gameTitle,
    description: entry.gameShortText,
    type: "game",
    url: entry.gameUrl,
    imageUrl: entry.gameCoverUrl,
    source: "itchio",
    sourceGameId: gameId,
    releasedAt: entry.submittedAt,
    createdBy: null,
  });
  const seen = new Set<string>();
  entry.contributors.forEach((c, j) => {
    const name = c.name?.trim();
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    bulkCredits.push({ projectId, displayName: name, source: "entry-contributors", sortOrder: j });
  });
  bulkCorpusCount += 1;
}

if (bulkCredits.length > 0) await db.insert(projectContributors).values(bulkCredits);
if (bulkClaims.length > 0) await db.insert(projectTeams).values(bulkClaims);
if (bulkTeamPlacements.length > 0) await db.insert(teamProjects).values(bulkTeamPlacements);
if (bulkPlacements.length > 0) {
  await db.insert(profileProjects).values(bulkPlacements).onConflictDoNothing();
}
if (bulkJamLinks.length > 0) await db.insert(projectJamLinks).values(bulkJamLinks);

// The §8.3 cover-inheritance payoff, seeded last because it needs a project
// that actually has cover art — which on a corpus environment means one of
// the itch-anchored rows above, curated or bulk. The post carries no images
// of its own, so its board card can only look right by inheriting.
const [coverProject] = await db
  .select({ id: projects.id, title: projects.title })
  .from(projects)
  .where(and(like(projects.id, "seedproj-%"), isNotNull(projects.imageUrl)))
  .limit(1);
if (coverProject) {
  const [row] = await db
    .insert(collabPosts)
    .values({
      authorId: owner.id,
      projectId: coverProject.id,
      teamId: "seedprojteam-halfmoon",
      type: "hobby",
      title: "Porting help for our jam entry",
      description:
        POST_MARKER +
        " No images of its own, linked to a project that has a real itch cover — the board card should render that cover anyway.",
      projectName: coverProject.title,
      platforms: ["PC", "Web"],
      projectLength: "1-4 weeks",
      experienceLevel: "any",
      contactType: "discord_server",
      contactMethod: "discord.gg/seeded-example",
      status: "recruiting",
      expiresAt: new Date(Date.now() + 18 * DAY),
      createdAt: ago(2),
      updatedAt: ago(2),
    })
    .returning({ id: collabPosts.id });
  const coverRole = ["Programmer", "Developer", "Game Developer"]
    .map(roleId)
    .find((id) => id != null);
  if (coverRole != null) {
    await db.insert(collabPostRoles).values({ postId: row.id, roleId: coverRole });
  }
}

// ── Report ───────────────────────────────────────────────────────────────────

const [totals] = await db
  .select({
    projects: sql<number>`(SELECT count(*)::int FROM ${projects} WHERE id LIKE 'seedproj-%')`,
    credits: sql<number>`(SELECT count(*)::int FROM ${projectContributors} c JOIN ${projects} p ON p.id = c.project_id WHERE p.id LIKE 'seedproj-%')`,
    claims: sql<number>`(SELECT count(*)::int FROM ${projectTeams} t WHERE t.project_id LIKE 'seedproj-%')`,
    jamLinks: sql<number>`(SELECT count(*)::int FROM ${projectJamLinks} l WHERE l.project_id LIKE 'seedproj-%')`,
    profilePlacements: sql<number>`(SELECT count(*)::int FROM ${profileProjects} WHERE id LIKE 'seedpp-%')`,
    teamPlacements: sql<number>`(SELECT count(*)::int FROM ${teamProjects} WHERE id LIKE 'seedtp-%')`,
    teams: sql<number>`(SELECT count(*)::int FROM ${teams} WHERE id LIKE 'seedprojteam-%')`,
    profiles: sql<number>`(SELECT count(*)::int FROM ${developerProfiles} WHERE id LIKE 'seedprojprof-%')`,
    collabPosts: sql<number>`(SELECT count(*)::int FROM ${collabPosts} WHERE description LIKE ${POST_MARKER + "%"})`,
  })
  .from(sql`(SELECT 1) AS one`);

console.log(`seeded as ${owner.name} (${corpusNote}; ${bulkCorpusCount} bulk corpus rows):`);
console.table(totals);
console.log(`
what to check (curated rows; the rest is volume):
  /projects/seed-signal-decay    kitchen sink: credits mix, MADE BY, both jam-link shapes, EDIT + slug rename
  /projects/seed-bramble-tileset read-only for you (stranger's project, other team's claim)
  /projects/seed-night-loops     audio + sub-types editable in the sheet
  /projects/seed-jamtimer        app + web/mobile sub-types
  /projects/seed-paperwing-site  web kind, VISIT SITE CTA
  /projects/seed-paper-zine      unanchored 'other' → noindex, no editors
  /projects/seed-secret-prototype  404 signed-out, renders (noindex) for you
  /projects/seed-moth-light      jam record from project_jam_links only
  /projects/seed-crossjam        derived multi-jam JAM RECORD with ranks (if corpus)
  /projects/seed-restricted      renders with itch links suppressed (if corpus)
  /projects/seed-strangers-game  viewerCanEdit false, noindex (if corpus)
  /profile (yours)               showcase cards link inward; Moth Light + legacy jam log rows
  /teams/half-moon-bay           STALE SNAPSHOT tile must read "Signal Decay"; legacy jam row intact
  /teams/driftline               Bramble tile, canonical-first
  the busiest jam's page         community shelf populated (6 member placements point at it)
  /projects/seed-b0-…            15-credit CREDITS grid (the first bulk row's page)

part 8 (collab ↔ project linkage):
  /projects/seed-signal-decay    RECRUITING section reads "2 open posts" — the closed one must not count
  → SEE THE POSTS                board filtered to this project, named chip
  RECRUIT (hero, editors)        wizard opens with project AND team pre-linked (one claiming team)
  /teams/half-moon-bay           POST AN OPENING opens the wizard with the team pre-linked
  the board                      the cross-jam post shows the PROJECT's itch cover, having none of its own
  any linked post's detail       RECRUITING FOR panel: project page link + "all posts for this project"
  wizard PROJECT step            picker lists your editable projects, Half Moon Bay's first
  "Crew for whatever we build"   team post with NO project — the picker must stay skippable
  "Rust dev to help finish…"     solo post that still carries a project link
  "Playtesters for an…"          links an unpublished project (the picker includes those on purpose)
  "Sound designer for Signal…"   expires in 2d: CLOSES IN badge + EXTEND, and the sweep's nudge
`);
process.exit(0);
