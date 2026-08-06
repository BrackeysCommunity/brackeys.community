/**
 * One-time (but re-runnable) backfill: mint a canonical `project.projects`
 * row for every existing placement, then stamp the placements with it.
 *
 * Every step is idempotent — it looks at what's already linked and only
 * does the rest — so the script can be re-run after a partial failure, or
 * after new placements land from a sync that hasn't converged yet.
 *
 *   bun scripts/backfill-projects.ts            # apply
 *   bun scripts/backfill-projects.ts --dry-run  # report only, write nothing
 *
 * Order matters (see the plan's §1.4):
 *   1. imported placements → projects, deduped on the itch game id
 *   2. manual placements   → one project each (no cross-owner fuzzy dedupe)
 *   3. stamp project_id back onto every placement
 *   4. contributors (placement owners, entry contributors, team_members text)
 *   5. project_teams from team placements
 *   6. project_jam_links for jam appearances that can't be derived
 *
 * Deliberately *not* careful about preserving owner edits: the app is
 * pre-prod, every placement row is dummy user data, and the real data
 * (scraped jams and entries) is never written here. Worst case the whole
 * thing is re-run from scratch. The snapshot-gated refresh that protects
 * real users' edits belongs to the sync convergence step, not to this.
 */
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  developerProfiles,
  itchJamEntries,
  linkedAccounts,
  profileProjects,
  projectContributors,
  projectJamLinks,
  projectTeams,
  projects,
  teamProjects,
} from "@/db/schema";
import { normalizeItchProfileUrl } from "@/lib/itchio-jam-sync";
import {
  insertProject,
  pickReleasedAt,
  projectTypeFromPlacement,
  upsertProjectForItchGame,
} from "@/lib/projects";

const DRY_RUN = process.argv.includes("--dry-run");

const stats = {
  projectsFromImports: 0,
  projectsFromManual: 0,
  profilePlacementsLinked: 0,
  teamPlacementsLinked: 0,
  teamPlacementsReusingSource: 0,
  contributorsFromPlacements: 0,
  contributorsFromEntries: 0,
  contributorsFromTeamMembers: 0,
  projectTeamsLinked: 0,
  jamLinksCreated: 0,
  releasedAtSet: 0,
};

function log(step: string, detail: string) {
  console.log(`${DRY_RUN ? "[dry-run] " : ""}${step}: ${detail}`);
}

// ── Step 0: what are we working with ────────────────────────────────────────

const profilePlacements = await db.select().from(profileProjects);
const teamPlacements = await db.select().from(teamProjects);

log(
  "step 0",
  `${profilePlacements.length} profile placements, ${teamPlacements.length} team placements`,
);

/** Numeric `sourceId`, or null — both id spaces are numeric strings. */
function numericSourceId(placement: { sourceId: string | null }): number | null {
  if (!placement.sourceId || !/^\d+$/.test(placement.sourceId)) return null;
  const parsed = Number(placement.sourceId);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * The itch game id behind a placement, or null when it isn't an itch import.
 *
 * A library row (`source: 'itchio'`) carries the game id directly. A jam row
 * (`source: 'itchio-jam'`) carries an **entry** id, and only
 * `itch.jam_entries` can turn that into a game id — the two id spaces
 * overlap numerically, so the source column decides, never the value.
 */
const entryIds = [
  ...new Set(
    [...profilePlacements, ...teamPlacements]
      .filter((p) => p.source === "itchio-jam")
      .map(numericSourceId)
      .filter((id): id is number => id != null),
  ),
];

const entryRows =
  entryIds.length > 0
    ? await db
        .select({
          entryId: itchJamEntries.entryId,
          gameId: itchJamEntries.gameId,
          jamId: itchJamEntries.jamId,
          gameTitle: itchJamEntries.gameTitle,
          gameShortText: itchJamEntries.gameShortText,
          gameUrl: itchJamEntries.gameUrl,
          gameCoverUrl: itchJamEntries.gameCoverUrl,
          submittedAt: itchJamEntries.submittedAt,
          contributors: itchJamEntries.contributors,
        })
        .from(itchJamEntries)
        .where(inArray(itchJamEntries.entryId, entryIds))
    : [];
const entryById = new Map(entryRows.map((row) => [row.entryId, row]));

function gameIdFor(placement: { source: string; sourceId: string | null }): number | null {
  const value = numericSourceId(placement);
  if (value == null) return null;
  if (placement.source === "itchio") return value;
  if (placement.source === "itchio-jam") return entryById.get(value)?.gameId ?? null;
  return null;
}

log(
  "step 0",
  `${entryIds.length} jam-imported placements resolved through ${entryRows.length} scraped entries`,
);

// ── Step 1: imported placements → projects, deduped on game id ──────────────

/** Everything we know about one itch game, gathered from every placement
 * that imported it plus the scraped entry row. The richest field wins. */
interface GameSeed {
  gameId: number;
  title: string;
  description: string | null;
  url: string | null;
  imageUrl: string | null;
  type: ReturnType<typeof projectTypeFromPlacement>;
  published: boolean;
  restrictedAt: Date | null;
  releasedAt: Date | null;
  createdBy: string | null;
}

const seedsByGameId = new Map<number, GameSeed>();

function mergeGameSeed(gameId: number, candidate: Partial<GameSeed> & { title: string }) {
  const existing = seedsByGameId.get(gameId);
  if (!existing) {
    seedsByGameId.set(gameId, {
      gameId,
      title: candidate.title,
      description: candidate.description ?? null,
      url: candidate.url ?? null,
      imageUrl: candidate.imageUrl ?? null,
      type: candidate.type ?? "game",
      // AND across placements: any owner reporting it unpublished means the
      // provider said so for that copy, and the safe reading is unpublished.
      published: candidate.published ?? true,
      restrictedAt: candidate.restrictedAt ?? null,
      releasedAt: candidate.releasedAt ?? null,
      createdBy: candidate.createdBy ?? null,
    });
    return;
  }
  existing.description ??= candidate.description ?? null;
  existing.url ??= candidate.url ?? null;
  existing.imageUrl ??= candidate.imageUrl ?? null;
  existing.restrictedAt ??= candidate.restrictedAt ?? null;
  existing.releasedAt ??= candidate.releasedAt ?? null;
  existing.createdBy ??= candidate.createdBy ?? null;
  if (candidate.published === false) existing.published = false;
  // A placement that says something more specific than "game" wins — an
  // owner who typed "tool" knows better than the sync's hardcoded default.
  if (existing.type === "game" && candidate.type && candidate.type !== "game") {
    existing.type = candidate.type;
  }
}

for (const placement of profilePlacements) {
  const gameId = gameIdFor(placement);
  if (gameId == null) continue;
  const entry =
    placement.source === "itchio-jam" ? entryById.get(numericSourceId(placement)!) : null;
  mergeGameSeed(gameId, {
    // The scraped entry is the provider's own title; a placement's may have
    // been edited to something surface-specific.
    title: entry?.gameTitle ?? placement.title,
    description: entry?.gameShortText ?? placement.description,
    url: entry?.gameUrl ?? placement.url,
    // Provider CDN URLs only. A placement's uploaded `imageKey` lives in a
    // per-user MinIO namespace and would inherit that user's lifecycle —
    // the canonical row must never reference it.
    imageUrl: entry?.gameCoverUrl ?? placement.imageUrl,
    type: projectTypeFromPlacement(placement.type),
    published: placement.published,
    restrictedAt: placement.restrictedAt,
    releasedAt: pickReleasedAt([placement.publishedAt, placement.participatedAt]),
    createdBy: placement.profileId,
  });
}

for (const placement of teamPlacements) {
  const gameId = gameIdFor(placement);
  if (gameId == null) continue;
  const entry =
    placement.source === "itchio-jam" ? entryById.get(numericSourceId(placement)!) : null;
  mergeGameSeed(gameId, {
    title: entry?.gameTitle ?? placement.title,
    description: entry?.gameShortText ?? placement.description,
    url: entry?.gameUrl ?? placement.url,
    imageUrl: entry?.gameCoverUrl ?? placement.imageUrl,
    type: projectTypeFromPlacement(placement.type),
    releasedAt: pickReleasedAt([placement.releasedAt, placement.participatedAt]),
    createdBy: placement.addedBy,
  });
}

/** game id → canonical project id. */
const projectByGameId = new Map<number, string>();

for (const seed of seedsByGameId.values()) {
  if (DRY_RUN) {
    projectByGameId.set(seed.gameId, `dry-run-${seed.gameId}`);
    stats.projectsFromImports += 1;
    continue;
  }
  const before = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.sourceGameId, seed.gameId))
    .limit(1);
  const projectId = await upsertProjectForItchGame(seed.gameId, {
    title: seed.title,
    description: seed.description,
    type: seed.type,
    url: seed.url,
    imageUrl: seed.imageUrl,
    published: seed.published,
    restrictedAt: seed.restrictedAt,
    releasedAt: seed.releasedAt,
    createdBy: seed.createdBy,
    // `classification` / `embedType` / `releaseStatus` start null even for
    // imports: the API values were never stored (they were discarded at
    // import time), so they backfill themselves on each account's next
    // library sync once the write paths converge.
  });
  projectByGameId.set(seed.gameId, projectId);
  if (before.length === 0) stats.projectsFromImports += 1;
}

log("step 1", `${stats.projectsFromImports} projects minted from ${seedsByGameId.size} itch games`);

// ── Step 2: manual placements → one project each ────────────────────────────

/** placement id → canonical project id, for the rows step 3 stamps. */
const projectByProfilePlacement = new Map<string, string>();
const projectByTeamPlacement = new Map<string, string>();

for (const placement of profilePlacements) {
  const gameId = gameIdFor(placement);
  if (gameId != null) {
    const projectId = projectByGameId.get(gameId);
    if (projectId) projectByProfilePlacement.set(placement.id, projectId);
    continue;
  }
  // Already linked by an earlier run — reuse rather than minting a second.
  if (placement.projectId) {
    projectByProfilePlacement.set(placement.id, placement.projectId);
    continue;
  }
  if (DRY_RUN) {
    projectByProfilePlacement.set(placement.id, `dry-run-manual-${placement.id}`);
    stats.projectsFromManual += 1;
    continue;
  }
  const projectId = await insertProject({
    title: placement.title,
    description: placement.description,
    type: projectTypeFromPlacement(placement.type),
    subTypes: placement.subTypes ?? [],
    url: placement.url,
    // Manual rows only ever have a user-scoped uploaded image or a pasted
    // URL. A pasted URL is user-independent and safe to seed; an uploaded
    // key is not, and stays the placement's own override.
    imageUrl: placement.imageKey ? null : placement.imageUrl,
    published: placement.published,
    restrictedAt: placement.restrictedAt,
    releasedAt: pickReleasedAt([placement.publishedAt, placement.participatedAt]),
    createdBy: placement.profileId,
    source: "manual",
  });
  projectByProfilePlacement.set(placement.id, projectId);
  stats.projectsFromManual += 1;
}

for (const placement of teamPlacements) {
  const gameId = gameIdFor(placement);
  if (gameId != null) {
    const projectId = projectByGameId.get(gameId);
    if (projectId) projectByTeamPlacement.set(placement.id, projectId);
    continue;
  }
  if (placement.projectId) {
    projectByTeamPlacement.set(placement.id, placement.projectId);
    continue;
  }
  // `source_profile_project_id` finally pays off: an imported copy of a
  // member's row is the *same project*, not a second one.
  if (placement.sourceProfileProjectId) {
    const shared = projectByProfilePlacement.get(placement.sourceProfileProjectId);
    if (shared) {
      projectByTeamPlacement.set(placement.id, shared);
      stats.teamPlacementsReusingSource += 1;
      continue;
    }
  }
  if (DRY_RUN) {
    projectByTeamPlacement.set(placement.id, `dry-run-manual-${placement.id}`);
    stats.projectsFromManual += 1;
    continue;
  }
  const projectId = await insertProject({
    title: placement.title,
    description: placement.description,
    type: projectTypeFromPlacement(placement.type),
    url: placement.url,
    imageUrl: placement.imageKey ? null : placement.imageUrl,
    releasedAt: pickReleasedAt([placement.releasedAt, placement.participatedAt]),
    createdBy: placement.addedBy,
    source: "manual",
  });
  projectByTeamPlacement.set(placement.id, projectId);
  stats.projectsFromManual += 1;
}

log(
  "step 2",
  `${stats.projectsFromManual} projects minted from manual placements ` +
    `(${stats.teamPlacementsReusingSource} team rows reused their source member's project)`,
);

// ── Step 3: stamp project_id onto the placements ────────────────────────────

for (const placement of profilePlacements) {
  const projectId = projectByProfilePlacement.get(placement.id);
  if (!projectId || placement.projectId === projectId) continue;
  stats.profilePlacementsLinked += 1;
  if (DRY_RUN) continue;
  await db.update(profileProjects).set({ projectId }).where(eq(profileProjects.id, placement.id));
}

for (const placement of teamPlacements) {
  const projectId = projectByTeamPlacement.get(placement.id);
  if (!projectId || placement.projectId === projectId) continue;
  stats.teamPlacementsLinked += 1;
  if (DRY_RUN) continue;
  await db.update(teamProjects).set({ projectId }).where(eq(teamProjects.id, placement.id));
}

log(
  "step 3",
  `${stats.profilePlacementsLinked} profile + ${stats.teamPlacementsLinked} team placements stamped`,
);

// ── Step 4: contributors ────────────────────────────────────────────────────

/** Existing credits, so a re-run adds rather than duplicates. */
const existingCredits = DRY_RUN
  ? []
  : await db
      .select({
        projectId: projectContributors.projectId,
        profileId: projectContributors.profileId,
        displayName: projectContributors.displayName,
      })
      .from(projectContributors);

/** Dedupe within a project case-insensitively by display name, and by
 * profile id where there is one. */
const creditKeys = new Set(
  existingCredits
    .flatMap((row) => [
      row.profileId ? `${row.projectId}|id:${row.profileId}` : null,
      `${row.projectId}|name:${row.displayName.trim().toLowerCase()}`,
    ])
    .filter((key): key is string => key != null),
);

const pendingCredits: (typeof projectContributors.$inferInsert)[] = [];

function addCredit(credit: typeof projectContributors.$inferInsert) {
  const nameKey = `${credit.projectId}|name:${credit.displayName.trim().toLowerCase()}`;
  const idKey = credit.profileId ? `${credit.projectId}|id:${credit.profileId}` : null;
  if (creditKeys.has(nameKey) || (idKey && creditKeys.has(idKey))) return false;
  creditKeys.add(nameKey);
  if (idKey) creditKeys.add(idKey);
  pendingCredits.push(credit);
  return true;
}

// 4a. Each placement's owner is a contributor.
const profileIds = [...new Set(profilePlacements.map((p) => p.profileId))];
const profileRows =
  profileIds.length > 0
    ? await db
        .select({
          id: developerProfiles.id,
          guildNickname: developerProfiles.guildNickname,
          discordUsername: developerProfiles.discordUsername,
        })
        .from(developerProfiles)
        .where(inArray(developerProfiles.id, profileIds))
    : [];
const profileNameById = new Map(
  profileRows.map((row) => [row.id, row.guildNickname ?? row.discordUsername ?? "Unknown"]),
);

for (const placement of profilePlacements) {
  const projectId = projectByProfilePlacement.get(placement.id);
  if (!projectId) continue;
  const added = addCredit({
    projectId,
    profileId: placement.profileId,
    displayName: profileNameById.get(placement.profileId) ?? "Unknown",
    source: "placement",
  });
  if (added) stats.contributorsFromPlacements += 1;
}

// 4b. Scraped `contributors` jsonb → credits, profile-matched by normalized
//     itch URL against linked accounts (the same two-tier match the jam sync
//     implements). Names alone never link a profile.
const itchAccounts = await db
  .select({
    profileId: linkedAccounts.profileId,
    profileUrl: linkedAccounts.providerProfileUrl,
  })
  .from(linkedAccounts)
  .where(and(eq(linkedAccounts.provider, "itchio"), isNotNull(linkedAccounts.providerProfileUrl)));
const profileByItchUrl = new Map(
  itchAccounts
    .map((row) => [normalizeItchProfileUrl(row.profileUrl), row.profileId] as const)
    .filter((pair): pair is [string, string] => pair[0] != null),
);

for (const entry of entryRows) {
  const projectId = projectByGameId.get(entry.gameId);
  if (!projectId) continue;
  for (const contributor of entry.contributors) {
    const name = contributor.name?.trim();
    if (!name) continue;
    const added = addCredit({
      projectId,
      profileId: profileByItchUrl.get(normalizeItchProfileUrl(contributor.url) ?? "") ?? null,
      displayName: name,
      source: "entry-contributors",
    });
    if (added) stats.contributorsFromEntries += 1;
  }
}

// 4c. `team_members text[]` on profile placements — the legacy free-text
//     credits column, now a display source only.
for (const placement of profilePlacements) {
  const projectId = projectByProfilePlacement.get(placement.id);
  if (!projectId) continue;
  for (const name of placement.teamMembers ?? []) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    if (addCredit({ projectId, displayName: trimmed, source: "manual" })) {
      stats.contributorsFromTeamMembers += 1;
    }
  }
}

if (!DRY_RUN && pendingCredits.length > 0) {
  // Chunked: a member with a long history can produce a few thousand rows,
  // and a single VALUES list that wide is worth avoiding.
  for (let i = 0; i < pendingCredits.length; i += 500) {
    await db
      .insert(projectContributors)
      .values(pendingCredits.slice(i, i + 500))
      // The partial unique index makes a concurrent duplicate a no-op.
      .onConflictDoNothing();
  }
}

log(
  "step 4",
  `${stats.contributorsFromPlacements} owner + ${stats.contributorsFromEntries} entry + ` +
    `${stats.contributorsFromTeamMembers} free-text credits`,
);

// ── Step 5: project_teams from team placements ──────────────────────────────

const teamLinkRows: (typeof projectTeams.$inferInsert)[] = [];
const seenTeamLinks = new Set<string>();
for (const placement of teamPlacements) {
  const projectId = projectByTeamPlacement.get(placement.id);
  if (!projectId) continue;
  const key = `${projectId}|${placement.teamId}`;
  if (seenTeamLinks.has(key)) continue;
  seenTeamLinks.add(key);
  teamLinkRows.push({ projectId, teamId: placement.teamId });
}
stats.projectTeamsLinked = teamLinkRows.length;
if (!DRY_RUN && teamLinkRows.length > 0) {
  await db.insert(projectTeams).values(teamLinkRows).onConflictDoNothing();
}
log("step 5", `${stats.projectTeamsLinked} team → project claims`);

// ── Step 6: jam links that can't be derived ─────────────────────────────────

/**
 * An imported project's jam appearances come free from
 * `projects.source_game_id = jam_entries.game_id`. These rows are for the
 * rest: a manual jam log entry, or an appearance whose entry row we don't
 * hold. Writing a row for a derivable appearance would double it on the
 * project page.
 */
const derivableGameJamPairs = new Set(
  entryRows.map((entry) => `${projectByGameId.get(entry.gameId) ?? ""}|${entry.jamId}`),
);

const existingJamLinks = DRY_RUN
  ? []
  : await db
      .select({ projectId: projectJamLinks.projectId, jamId: projectJamLinks.jamId })
      .from(projectJamLinks);
const jamLinkKeys = new Set(
  existingJamLinks.map((row) => `${row.projectId}|${row.jamId ?? "text"}`),
);

const jamLinkRows: (typeof projectJamLinks.$inferInsert)[] = [];

function addJamLink(row: typeof projectJamLinks.$inferInsert) {
  // A row with no jamId and no name says nothing.
  if (row.jamId == null && !row.jamName) return;
  if (row.jamId != null && derivableGameJamPairs.has(`${row.projectId}|${row.jamId}`)) return;
  const key = `${row.projectId}|${row.jamId ?? `text:${row.jamName}`}`;
  if (jamLinkKeys.has(key)) return;
  jamLinkKeys.add(key);
  jamLinkRows.push(row);
}

for (const placement of profilePlacements) {
  const projectId = projectByProfilePlacement.get(placement.id);
  if (!projectId) continue;
  addJamLink({
    projectId,
    jamId: placement.jamId,
    jamName: placement.jamName,
    jamUrl: placement.jamUrl,
    submissionUrl: placement.submissionUrl,
    result: placement.result,
    participatedAt: placement.participatedAt,
  });
}

for (const placement of teamPlacements) {
  const projectId = projectByTeamPlacement.get(placement.id);
  if (!projectId) continue;
  addJamLink({
    projectId,
    jamId: placement.jamId,
    jamName: placement.jamName,
    jamUrl: placement.jamUrl,
    submissionUrl: placement.submissionUrl,
    result: placement.result,
    participatedAt: placement.participatedAt,
  });
}

stats.jamLinksCreated = jamLinkRows.length;
if (!DRY_RUN && jamLinkRows.length > 0) {
  for (let i = 0; i < jamLinkRows.length; i += 500) {
    await db
      .insert(projectJamLinks)
      .values(jamLinkRows.slice(i, i + 500))
      .onConflictDoNothing();
  }
}
log("step 6", `${stats.jamLinksCreated} explicit jam links (derivable appearances skipped)`);

// ── Step 7: fill in any missing ship dates from the derived jam record ──────

/**
 * A project whose only date signal is when it was submitted to a jam. The
 * placement columns are preferred above (they're the owner's own answer);
 * this only touches rows that still have nothing.
 */
if (!DRY_RUN) {
  const dated = await db
    .update(projects)
    .set({
      releasedAt: sql`(
        SELECT MIN(${itchJamEntries.submittedAt})
        FROM ${itchJamEntries}
        WHERE ${itchJamEntries.gameId} = ${projects.sourceGameId}
      )`,
    })
    .where(and(isNull(projects.releasedAt), isNotNull(projects.sourceGameId)))
    .returning({ id: projects.id });
  stats.releasedAtSet = dated.length;
}
log("step 7", `${stats.releasedAtSet} ship dates derived from first jam submission`);

// ── Report ─────────────────────────────────────────────────────────────────

const [counts] = await db
  .select({
    projects: sql<number>`(SELECT count(*)::int FROM ${projects})`,
    contributors: sql<number>`(SELECT count(*)::int FROM ${projectContributors})`,
    teamClaims: sql<number>`(SELECT count(*)::int FROM ${projectTeams})`,
    jamLinks: sql<number>`(SELECT count(*)::int FROM ${projectJamLinks})`,
    unlinkedProfile: sql<number>`(SELECT count(*)::int FROM ${profileProjects} WHERE project_id IS NULL)`,
    unlinkedTeam: sql<number>`(SELECT count(*)::int FROM ${teamProjects} WHERE project_id IS NULL)`,
  })
  .from(sql`(SELECT 1) AS one`);

console.log("");
console.log(DRY_RUN ? "— dry run, nothing written —" : "— applied —");
console.table(stats);
console.log("now in the database:", counts);

process.exit(0);
