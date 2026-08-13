/**
 * Canonical-project writes, with the database handle passed in.
 *
 * **Every write that mints or links a `project.projects` row lives here**, and
 * nothing in this file may import `@/db`. That is the whole point: the
 * `itchio-library-sync` cron service runs its own copy of the sync
 * orchestration against its own drizzle client (deliberately — see the
 * hardening plan's non-goals), and it imports this module by path the same way
 * it imports `src/db/schema.ts`. If the upsert lived behind the app's `db`
 * singleton, the sweep would keep minting placements with no canonical row
 * behind them and the backfill script would stay load-bearing forever.
 *
 * `lib/projects.ts` re-exports these bound to the app's `db` so app callers
 * don't pass a handle around.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

// Relative, not `@/` — the sync service imports this file by path and runs it
// under bun with no bundler, so nothing here may depend on the app's alias
// resolving. Same reason `src/db/schema.ts` has no `@/` imports of its own.
import {
  type ItchJamContributor,
  type ProjectLink,
  type ProjectProviderStats,
  type ProjectSourceSnapshot,
  type ProjectType,
  developerProfiles,
  itchJamEntries,
  linkedAccounts,
  profileProjects,
  projectContributors,
  projects,
} from "../db/schema";
import { normalizeItchProfileUrl } from "./itch-urls";
import {
  RESERVED_PROJECT_SLUGS,
  platformsFromTraits,
  projectTypeFromClassification,
  projectTypeFromPlacement,
  slugifyProjectTitle,
} from "./project-taxonomy";

/**
 * Any drizzle node-postgres client: the app's `db` singleton or the sync
 * service's pool-bound one. Deliberately not the app's concrete type — this
 * module has to typecheck inside `services/itchio-library-sync` too.
 */
export type ProjectDb = NodePgDatabase<Record<string, never>>;

// ── Slugs and inserts ───────────────────────────────────────────────────────

/** 4 hex chars — enough to separate same-titled projects without turning
 * the URL into an id. */
function slugSuffix(): string {
  return Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, "0");
}

/**
 * A free slug for `title`. Checks the base form first, then appends a hex
 * suffix.
 *
 * Advisory only: `projects.slug` is UNIQUE, so a concurrent insert can
 * still lose the race. Callers insert with a retry rather than trusting
 * this to hold.
 */
export async function findFreeProjectSlug(
  db: ProjectDb,
  title: string,
  attempts = 5,
): Promise<string> {
  const base = slugifyProjectTitle(title);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${slugSuffix()}`;
    if (RESERVED_PROJECT_SLUGS.has(candidate)) continue;
    const [taken] = await db
      .select({ slug: projects.slug })
      .from(projects)
      .where(eq(projects.slug, candidate))
      .limit(1);
    if (!taken) return candidate;
  }
  // Every candidate collided — fall back to something that effectively
  // cannot, rather than failing the insert.
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Postgres unique-violation. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "23505"
  );
}

export interface ProjectSeed {
  title: string;
  description?: string | null;
  type?: ProjectType;
  subTypes?: string[];
  url?: string | null;
  /** Secondary links (repo, live site, store page) — the rail beside the CTA. */
  links?: ProjectLink[];
  imageUrl?: string | null;
  classification?: string | null;
  embedType?: string | null;
  releaseStatus?: string | null;
  published?: boolean;
  restrictedAt?: Date | null;
  releasedAt?: Date | null;
  createdBy?: string | null;
}

/**
 * Insert a project, retrying on a slug collision the pre-check missed.
 * Returns the new row's id.
 */
export async function insertProject(
  db: ProjectDb,
  seed: ProjectSeed & { source?: "manual" | "itchio"; sourceGameId?: number | null },
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = await findFreeProjectSlug(db, seed.title);
    try {
      const [row] = await db
        .insert(projects)
        .values({
          slug,
          title: seed.title,
          description: seed.description ?? null,
          type: seed.type ?? "game",
          subTypes: seed.subTypes ?? [],
          url: seed.url ?? null,
          links: seed.links ?? [],
          imageUrl: seed.imageUrl ?? null,
          classification: seed.classification ?? null,
          embedType: seed.embedType ?? null,
          releaseStatus: seed.releaseStatus ?? null,
          published: seed.published ?? true,
          restrictedAt: seed.restrictedAt ?? null,
          releasedAt: seed.releasedAt ?? null,
          createdBy: seed.createdBy ?? null,
          source: seed.source ?? "manual",
          sourceGameId: seed.sourceGameId ?? null,
        })
        .returning({ id: projects.id });
      if (row) return row.id;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Either the slug or the game id collided. A game-id collision means
      // someone else just created this exact project — the caller's
      // `findProjectByGameId` will now find it, so surface the race.
      if (seed.sourceGameId != null) {
        const existing = await findProjectByGameId(db, seed.sourceGameId);
        if (existing) return existing;
      }
      // Otherwise it was the slug: loop and take a fresh suffix.
    }
  }
  throw new Error(`could not allocate a slug for project "${seed.title}"`);
}

/** The canonical project for an itch game id, if one exists. */
export async function findProjectByGameId(db: ProjectDb, gameId: number): Promise<string | null> {
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.sourceGameId, gameId))
    .limit(1);
  return row?.id ?? null;
}

/**
 * The canonical project for an itch game, created if it doesn't exist yet.
 *
 * `source_game_id` is the dedupe key: one game on itch is one project row
 * however many members import it. The partial unique index is what makes
 * the concurrent case safe — two members syncing the same game at once
 * race, and the loser reads back the winner's row.
 */
export async function upsertProjectForItchGame(
  db: ProjectDb,
  gameId: number,
  seed: ProjectSeed,
): Promise<string> {
  const existing = await findProjectByGameId(db, gameId);
  if (existing) return existing;
  return insertProject(db, { ...seed, source: "itchio", sourceGameId: gameId });
}

// ── Credits ─────────────────────────────────────────────────────────────────

export interface ContributorSeed {
  projectId: string;
  profileId?: string | null;
  displayName: string;
  role?: string | null;
  source: "placement" | "entry-contributors" | "manual";
}

/**
 * Add credits that aren't there yet. Never updates and never deletes — a
 * shipped credit is not a sync artifact, and a hand-edited row must survive
 * every later run.
 *
 * Deduped the same way the backfill does it: by profile id where there is
 * one, and case-insensitively by display name within the project (the itch
 * `contributors` jsonb and a `team_members` free-text entry routinely name
 * the same person twice).
 */
export async function ensureProjectContributors(
  db: ProjectDb,
  credits: ContributorSeed[],
): Promise<number> {
  const wanted = credits.filter((credit) => credit.displayName.trim().length > 0);
  if (wanted.length === 0) return 0;

  const projectIds = [...new Set(wanted.map((credit) => credit.projectId))];
  const existing = await db
    .select({
      projectId: projectContributors.projectId,
      profileId: projectContributors.profileId,
      displayName: projectContributors.displayName,
    })
    .from(projectContributors)
    .where(inArray(projectContributors.projectId, projectIds));

  const taken = new Set(
    existing.flatMap((row) => [
      `${row.projectId}|name:${row.displayName.trim().toLowerCase()}`,
      ...(row.profileId ? [`${row.projectId}|id:${row.profileId}`] : []),
    ]),
  );

  const rows: (typeof projectContributors.$inferInsert)[] = [];
  for (const credit of wanted) {
    const name = credit.displayName.trim();
    const nameKey = `${credit.projectId}|name:${name.toLowerCase()}`;
    const idKey = credit.profileId ? `${credit.projectId}|id:${credit.profileId}` : null;
    if (taken.has(nameKey) || (idKey && taken.has(idKey))) continue;
    taken.add(nameKey);
    if (idKey) taken.add(idKey);
    rows.push({
      projectId: credit.projectId,
      profileId: credit.profileId ?? null,
      displayName: name,
      role: credit.role ?? null,
      source: credit.source,
    });
  }
  if (rows.length === 0) return 0;

  for (let i = 0; i < rows.length; i += 500) {
    await db
      .insert(projectContributors)
      .values(rows.slice(i, i + 500))
      // The partial unique index makes a concurrent duplicate a no-op.
      .onConflictDoNothing();
  }
  return rows.length;
}

/**
 * Credit a placement's owner on the canonical project, under the name their
 * profile shows.
 *
 * Every mint path calls this: `createdBy` records who typed the row in, but
 * the credit is the fact the project page renders — and it's what keeps the
 * creator in the editor set (§1.3) after an account merge or a `createdBy`
 * that went null with a deleted user.
 */
export async function creditPlacementOwner(
  db: ProjectDb,
  projectId: string,
  profileId: string,
): Promise<void> {
  const displayName = await lazyDisplayName(db, profileId)();
  await ensureProjectContributors(db, [{ projectId, profileId, displayName, source: "placement" }]);
}

/**
 * itch profile URL → our profile id, for the contributor URLs on a scraped
 * entry. Names alone never link a profile — the same rule the participation
 * match follows.
 */
export async function resolveItchProfileIds(
  db: ProjectDb,
  urls: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const normalized = [...new Set(urls.map(normalizeItchProfileUrl).filter((u) => u != null))];
  if (normalized.length === 0) return new Map();

  const rows = await db
    .select({
      profileId: linkedAccounts.profileId,
      profileUrl: linkedAccounts.providerProfileUrl,
    })
    .from(linkedAccounts)
    .where(
      and(
        eq(linkedAccounts.provider, "itchio"),
        inArray(
          sql`lower(trim(TRAILING '/' FROM ${linkedAccounts.providerProfileUrl}))`,
          normalized,
        ),
      ),
    );

  const byUrl = new Map<string, string>();
  for (const row of rows) {
    const key = normalizeItchProfileUrl(row.profileUrl);
    if (key) byUrl.set(key, row.profileId);
  }
  return byUrl;
}

/**
 * The name a placement owner is credited under, looked up at most once per
 * convergence run — and not at all when every placement is already linked.
 */
function lazyDisplayName(db: ProjectDb, profileId: string): () => Promise<string> {
  let pending: Promise<string> | null = null;
  return () => {
    pending ??= db
      .select({
        guildNickname: developerProfiles.guildNickname,
        discordUsername: developerProfiles.discordUsername,
      })
      .from(developerProfiles)
      .where(eq(developerProfiles.id, profileId))
      .limit(1)
      .then(([row]) => row?.guildNickname ?? row?.discordUsername ?? "Unknown");
    return pending;
  };
}

// ── Provider facts ──────────────────────────────────────────────────────────

/**
 * The subset of itch's `/profile/games` payload the canonical row cares
 * about. Structural on purpose: the app's `ItchIoGame` and the sync
 * service's local copy both satisfy it without either importing the other.
 */
export interface ItchGameFacts {
  id: number;
  title: string;
  short_text?: string | null;
  url?: string | null;
  cover_url?: string | null;
  published?: boolean;
  published_at?: string | null;
  /** itch's raw classification: game | asset | tool | soundtrack | … */
  classification?: string | null;
  /** itch's `type`: default | html | flash | java | unity. */
  type?: string | null;
  /** released | in_development | on_hold | canceled | prototype. */
  release_status?: string | null;
  /** Platform/capability flags as the wire sends them (`p_windows`, …), or
   * `{}` when the game has none — always read via `platformsFromTraits`. */
  traits?: unknown;
  min_price?: number | null;
  downloads_count?: number | null;
  views_count?: number | null;
  purchases_count?: number | null;
}

/** The subset of a scraped `itch.jam_entries` row a project seeds from. */
export interface JamEntryFacts {
  entryId: number;
  gameId: number;
  gameTitle: string;
  gameShortText: string | null;
  gameUrl: string | null;
  gameCoverUrl: string | null;
  submittedAt: Date | null;
  contributors: ItchJamContributor[];
}

function seedFromItchGame(game: ItchGameFacts): ProjectSeed {
  return {
    title: game.title,
    description: game.short_text ?? null,
    url: game.url ?? null,
    imageUrl: game.cover_url ?? null,
    classification: game.classification ?? null,
    embedType: game.type ?? null,
    releaseStatus: game.release_status ?? null,
    // The provider's own kind when it gave us one; the sync's historical
    // "everything is a game" default otherwise.
    type: projectTypeFromClassification(game.classification) ?? "game",
    published: game.published ?? true,
    releasedAt: game.published_at ? new Date(game.published_at) : null,
  };
}

/**
 * A canonical seed from a scraped jam entry.
 *
 * Exported because the fast-follow that mints pages for the scraped corpus
 * seeds from exactly this row, and a second spelling of it would drift.
 */
export function seedFromJamEntry(entry: JamEntryFacts): ProjectSeed {
  return {
    title: entry.gameTitle,
    description: entry.gameShortText,
    url: entry.gameUrl,
    // Provider CDN URL only. A placement's uploaded `imageKey` lives in a
    // per-user MinIO namespace and would inherit that user's lifecycle, so
    // the canonical row must never reference it.
    imageUrl: entry.gameCoverUrl,
    // Jam entries are public record on itch regardless of the game page's
    // own visibility.
    published: true,
    releasedAt: entry.submittedAt,
  };
}

/** The slice of a canonical row `diffItchGameRow` reads. */
export interface SnapshotGatedRow {
  title: string;
  description: string | null;
  url: string | null;
  sourceSnapshot: ProjectSourceSnapshot | null;
}

function snapshotOf(facts: ItchGameFacts): ProjectSourceSnapshot {
  return {
    title: facts.title ?? null,
    description: facts.short_text ?? null,
    url: facts.url ?? null,
  };
}

function snapshotsEqual(a: ProjectSourceSnapshot, b: ProjectSourceSnapshot): boolean {
  return a.title === b.title && a.description === b.description && a.url === b.url;
}

/**
 * Snapshot-gated provider refresh for the owner-editable identity fields.
 *
 * The snapshot records what the provider said last time. A field refreshes
 * only while the row still equals that value — the moment an owner edits it,
 * row ≠ snapshot and the provider stops winning (the snapshot itself keeps
 * advancing, so a later revert to provider wording re-arms the gate).
 *
 * Rules per field:
 * - `url` — provider-owned outright for itch rows: a stale URL corrupts the
 *   restricted-visibility probe and the page CTA, so it refreshes on any
 *   change, snapshot or not.
 * - `title` / `description` — gated. Rows that predate the column
 *   (`sourceSnapshot` null) get the conservative treatment: seed the
 *   snapshot, touch the field only where it's a no-op (or a null
 *   description, which can't be destroying an edit) — drifted text survives
 *   until the *next* provider-side change.
 */
export function diffItchGameRow(
  row: SnapshotGatedRow,
  facts: ItchGameFacts,
): Partial<typeof projects.$inferInsert> | null {
  const patch: Partial<typeof projects.$inferInsert> = {};
  const stored = row.sourceSnapshot;
  const incoming = snapshotOf(facts);

  if (incoming.url && row.url !== incoming.url) patch.url = incoming.url;

  if (incoming.title && incoming.title !== row.title) {
    if (stored && row.title === stored.title) patch.title = incoming.title;
  }

  if (incoming.description !== row.description) {
    if (stored ? row.description === stored.description : row.description == null) {
      patch.description = incoming.description;
    }
  }

  if (!stored || !snapshotsEqual(stored, incoming)) patch.sourceSnapshot = incoming;

  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Refresh canonical fields from the provider.
 *
 * `title` / `description` / `url` go through `diffItchGameRow`'s
 * snapshot gate above. The remaining provider facts are fill-if-null (they
 * were never owner-editable surfaces worth diffing). Deliberately *never*
 * refreshed:
 *
 * - `published` — staff can hide a scrape-minted project by clearing it, and
 *   a sync that mirrored the provider blindly would undo that every hour.
 *
 * The curated `type` moves only on the run that first learns a
 * `classification`, and only from the historical `game` default: after that
 * it belongs to whoever edits it.
 */
export async function fillProviderFields(
  db: ProjectDb,
  pairs: { projectId: string; facts: ItchGameFacts }[],
): Promise<number> {
  if (pairs.length === 0) return 0;
  const factsByProjectId = new Map(pairs.map((pair) => [pair.projectId, pair.facts]));

  const rows = await db
    .select({
      id: projects.id,
      type: projects.type,
      title: projects.title,
      description: projects.description,
      url: projects.url,
      imageUrl: projects.imageUrl,
      imageKey: projects.imageKey,
      classification: projects.classification,
      embedType: projects.embedType,
      releaseStatus: projects.releaseStatus,
      releasedAt: projects.releasedAt,
      sourceSnapshot: projects.sourceSnapshot,
      platforms: projects.platforms,
      providerStats: projects.providerStats,
    })
    .from(projects)
    .where(inArray(projects.id, [...factsByProjectId.keys()]));

  let filled = 0;
  for (const row of rows) {
    const facts = factsByProjectId.get(row.id);
    if (!facts) continue;
    const patch: Partial<typeof projects.$inferInsert> = {
      ...diffItchGameRow(row, facts),
    };
    // A project-scoped upload always wins over the provider cover.
    if (row.imageUrl == null && row.imageKey == null && facts.cover_url) {
      patch.imageUrl = facts.cover_url;
    }
    if (row.releasedAt == null && facts.published_at) {
      patch.releasedAt = new Date(facts.published_at);
    }
    if (row.embedType == null && facts.type) patch.embedType = facts.type;
    if (row.releaseStatus == null && facts.release_status) {
      patch.releaseStatus = facts.release_status;
    }
    // Provider-owned, no gate: users can't edit classification or platforms.
    if (facts.classification && facts.classification !== row.classification) {
      patch.classification = facts.classification;
      if (row.classification == null) {
        // Only on the run that first learns it, and only away from the
        // historical default — an owner who typed "tool" keeps "tool".
        const derived = projectTypeFromClassification(facts.classification);
        if (derived && row.type === "game" && derived !== "game") patch.type = derived;
      }
    }
    const platforms = platformsFromTraits(facts.traits);
    if (platforms && JSON.stringify(platforms) !== JSON.stringify(row.platforms)) {
      patch.platforms = platforms;
    }
    // Stats snapshot + verbatim payload, rewritten when the numbers moved or
    // anything else about the row is being written anyway. A change in an
    // unmapped raw field alone won't rewrite — for an active game the stats
    // churn covers that within a day, and updatedAt stays meaningful.
    const stats: ProjectProviderStats = { syncedAt: new Date().toISOString() };
    if (facts.downloads_count != null) stats.downloadsCount = facts.downloads_count;
    if (facts.views_count != null) stats.viewsCount = facts.views_count;
    if (facts.purchases_count != null) stats.purchasesCount = facts.purchases_count;
    if (facts.min_price != null) stats.minPrice = facts.min_price;
    const prev = row.providerStats;
    const statsChanged =
      prev == null ||
      prev.downloadsCount !== stats.downloadsCount ||
      prev.viewsCount !== stats.viewsCount ||
      prev.purchasesCount !== stats.purchasesCount ||
      prev.minPrice !== stats.minPrice;
    if (Object.keys(patch).length === 0 && !statsChanged) continue;
    patch.providerStats = stats;
    patch.providerRaw = facts;
    await db
      .update(projects)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(projects.id, row.id));
    filled += 1;
  }
  return filled;
}

// ── Placement convergence ───────────────────────────────────────────────────

/** Numeric placement `sourceId`, or null — both itch id spaces are numeric
 * strings, and which one a value is depends on the `source` column. */
function numericSourceId(sourceId: string | null): number | null {
  if (!sourceId || !/^\d+$/.test(sourceId)) return null;
  const parsed = Number(sourceId);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

/** Stamp a canonical project onto a placement that doesn't have one. The
 * `IS NULL` guard makes a concurrent sync's write the one that stands. */
async function stampProfilePlacement(
  db: ProjectDb,
  placementId: string,
  projectId: string,
): Promise<void> {
  await db
    .update(profileProjects)
    .set({ projectId })
    .where(and(eq(profileProjects.id, placementId), isNull(profileProjects.projectId)));
}

/**
 * The canonical project behind one profile placement, minted if it hasn't got
 * one yet. Returns the project id.
 *
 * The mint rule is the backfill's, in one place so the two can't disagree: an
 * itch import dedupes onto its **game** id (a library row carries it
 * directly, a jam row carries an entry id that `itch.jam_entries` resolves),
 * and anything else gets its own manual row. Used by the flows that need a
 * project *now* for a placement created before convergence shipped — chiefly
 * `importMemberProject`, which must point the team at the member's project
 * rather than minting a second one for the same work.
 */
export async function ensureProfilePlacementProject(
  db: ProjectDb,
  placementId: string,
): Promise<string> {
  const [placement] = await db
    .select()
    .from(profileProjects)
    .where(eq(profileProjects.id, placementId))
    .limit(1);
  if (!placement) throw new Error(`no profile placement ${placementId}`);
  if (placement.projectId) return placement.projectId;

  const sourceValue = numericSourceId(placement.sourceId);
  let gameId: number | null = null;
  let entry: JamEntryFacts | null = null;
  if (sourceValue != null && placement.source === "itchio") {
    gameId = sourceValue;
  } else if (sourceValue != null && placement.source === "itchio-jam") {
    const [row] = await db
      .select()
      .from(itchJamEntries)
      .where(eq(itchJamEntries.entryId, sourceValue))
      .limit(1);
    if (row) {
      entry = row;
      gameId = row.gameId;
    }
  }

  const seed: ProjectSeed = entry
    ? seedFromJamEntry(entry)
    : {
        title: placement.title,
        description: placement.description,
        url: placement.url,
        // An uploaded image is in the owner's own MinIO namespace and would
        // inherit their account's lifecycle; it stays the placement's.
        imageUrl: placement.imageKey ? null : placement.imageUrl,
        published: placement.published,
        restrictedAt: placement.restrictedAt,
        releasedAt: placement.publishedAt ?? placement.participatedAt,
      };

  const projectId =
    gameId != null
      ? await upsertProjectForItchGame(db, gameId, { ...seed, createdBy: placement.profileId })
      : await insertProject(db, {
          ...seed,
          // `jam` was provenance wearing a type's clothes; the mapping fixes
          // that here rather than letting it reach the canonical row.
          type: projectTypeFromPlacement(placement.type),
          subTypes: placement.subTypes ?? [],
          createdBy: placement.profileId,
          source: "manual",
        });

  await stampProfilePlacement(db, placement.id, projectId);
  await creditPlacementOwner(db, projectId, placement.profileId);
  return projectId;
}

/**
 * Give every one of this account's itch **library** placements a canonical
 * project, and let the provider fill in canonical facts it alone knows.
 *
 * Runs over the account's whole `itchio` placement set rather than just the
 * games the API returned this time: a row imported before convergence shipped
 * has a null `project_id` and no other code path will ever fix it.
 */
export async function convergeLibraryPlacements(
  db: ProjectDb,
  profileId: string,
  games: ItchGameFacts[],
): Promise<{ linked: number; filled: number }> {
  const placements = await db
    .select({
      id: profileProjects.id,
      sourceId: profileProjects.sourceId,
      projectId: profileProjects.projectId,
      title: profileProjects.title,
      description: profileProjects.description,
      url: profileProjects.url,
      imageUrl: profileProjects.imageUrl,
      imageKey: profileProjects.imageKey,
      published: profileProjects.published,
      publishedAt: profileProjects.publishedAt,
      restrictedAt: profileProjects.restrictedAt,
    })
    .from(profileProjects)
    .where(and(eq(profileProjects.profileId, profileId), eq(profileProjects.source, "itchio")));
  if (placements.length === 0) return { linked: 0, filled: 0 };

  const factsByGameId = new Map(games.map((game) => [game.id, game]));
  const pairs: { projectId: string; facts: ItchGameFacts }[] = [];
  const credits: ContributorSeed[] = [];
  const ownerName = lazyDisplayName(db, profileId);
  let linked = 0;

  for (const placement of placements) {
    const gameId = numericSourceId(placement.sourceId);
    if (gameId == null) continue;
    const facts = factsByGameId.get(gameId) ?? null;

    let projectId = placement.projectId;
    if (!projectId) {
      const seed: ProjectSeed = facts
        ? seedFromItchGame(facts)
        : {
            // The game left the library (or this run's fetch didn't include
            // it); the placement is the only truth we hold. Its uploaded
            // image is user-scoped, so it never seeds the canonical cover.
            title: placement.title,
            description: placement.description,
            url: placement.url,
            imageUrl: placement.imageKey ? null : placement.imageUrl,
            published: placement.published,
            releasedAt: placement.publishedAt,
          };
      projectId = await upsertProjectForItchGame(db, gameId, {
        ...seed,
        restrictedAt: placement.restrictedAt,
        createdBy: profileId,
      });
      await stampProfilePlacement(db, placement.id, projectId);
      linked += 1;
    }

    credits.push({ projectId, profileId, displayName: await ownerName(), source: "placement" });
    if (facts) pairs.push({ projectId, facts });
  }

  await ensureProjectContributors(db, credits);
  const filled = await fillProviderFields(db, pairs);
  return { linked, filled };
}

/**
 * Give every one of this account's **jam** placements a canonical project,
 * deduped onto the same row the library import uses — the placement carries
 * an *entry* id, but the project is keyed on the entry's game id, which is
 * why one game entered in a jam and imported from the library is one page.
 *
 * Credits come from the scraped entry's `contributors` jsonb, profile-matched
 * by normalized itch URL. They are refreshed on every run (add-only) because
 * the scraper learns teammates after the fact.
 */
export async function convergeJamPlacements(
  db: ProjectDb,
  profileId: string,
  entries: JamEntryFacts[],
): Promise<{ linked: number }> {
  if (entries.length === 0) return { linked: 0 };

  const placements = await db
    .select({
      id: profileProjects.id,
      sourceId: profileProjects.sourceId,
      projectId: profileProjects.projectId,
    })
    .from(profileProjects)
    .where(and(eq(profileProjects.profileId, profileId), eq(profileProjects.source, "itchio-jam")));
  if (placements.length === 0) return { linked: 0 };

  const entryById = new Map(entries.map((entry) => [entry.entryId, entry]));
  const credits: ContributorSeed[] = [];
  const linkedEntries: { projectId: string; entry: JamEntryFacts }[] = [];
  const ownerName = lazyDisplayName(db, profileId);
  let linked = 0;

  for (const placement of placements) {
    const entryId = numericSourceId(placement.sourceId);
    if (entryId == null) continue;
    const entry = entryById.get(entryId);
    if (!entry) continue;

    let projectId = placement.projectId;
    if (!projectId) {
      projectId = await upsertProjectForItchGame(db, entry.gameId, {
        ...seedFromJamEntry(entry),
        createdBy: profileId,
      });
      await stampProfilePlacement(db, placement.id, projectId);
      linked += 1;
    }
    linkedEntries.push({ projectId, entry });
    credits.push({ projectId, profileId, displayName: await ownerName(), source: "placement" });
  }

  if (linkedEntries.length === 0) return { linked };

  const byUrl = await resolveItchProfileIds(
    db,
    linkedEntries.flatMap(({ entry }) => entry.contributors.map((c) => c.url)),
  );
  for (const { projectId, entry } of linkedEntries) {
    for (const contributor of entry.contributors) {
      credits.push({
        projectId,
        profileId: byUrl.get(normalizeItchProfileUrl(contributor.url) ?? "") ?? null,
        displayName: contributor.name ?? "",
        source: "entry-contributors",
      });
    }
  }

  await ensureProjectContributors(db, credits);
  return { linked };
}

// ── Scraped-corpus minting ──────────────────────────────────────────────────

/**
 * The canonical project for a *scraped* itch game — one nothing local
 * anchors — minted on demand from its most recent surviving jam entry.
 *
 * This is the lazy half of the corpus fast-follow: the `/projects/game/…`
 * route calls it on first visit. The seed and credits are exactly the bulk
 * pass's (`seedFromJamEntry` + the entry's `contributors` jsonb,
 * profile-matched by itch URL), and the whole thing is idempotent — the
 * partial unique index on `source_game_id` makes a concurrent double-visit
 * a no-op, with the loser reading back the winner's row.
 *
 * Returns null when we hold no live entry for the game: there is nothing to
 * make a page of. A scrape-minted row has no `createdBy`, no profile-linked
 * contributor and no team claim, so `canEditProject` is false for everyone —
 * nobody edits a stranger's game page until they claim it.
 */
export async function ensureProjectForScrapedGame(
  db: ProjectDb,
  gameId: number,
): Promise<{ id: string; slug: string; published: boolean } | null> {
  const projection = { id: projects.id, slug: projects.slug, published: projects.published };

  const [existing] = await db
    .select(projection)
    .from(projects)
    .where(eq(projects.sourceGameId, gameId))
    .limit(1);
  if (existing) return existing;

  const [entry] = await db
    .select()
    .from(itchJamEntries)
    .where(and(eq(itchJamEntries.gameId, gameId), isNull(itchJamEntries.missingSince)))
    // Hosts update titles and covers between jams; the latest submission is
    // the best provider truth we hold.
    .orderBy(sql`${itchJamEntries.submittedAt} DESC NULLS LAST`)
    .limit(1);
  if (!entry) return null;

  const projectId = await upsertProjectForItchGame(db, gameId, seedFromJamEntry(entry));

  const byUrl = await resolveItchProfileIds(
    db,
    entry.contributors.map((contributor) => contributor.url),
  );
  await ensureProjectContributors(
    db,
    entry.contributors.map((contributor) => ({
      projectId,
      profileId: byUrl.get(normalizeItchProfileUrl(contributor.url) ?? "") ?? null,
      displayName: contributor.name ?? "",
      source: "entry-contributors" as const,
    })),
  );

  const [row] = await db
    .select(projection)
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  return row ?? null;
}
