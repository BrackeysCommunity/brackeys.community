import { and, eq, gt, isNull, isNotNull, lt, notExists, sql, type SQL } from "drizzle-orm";

import {
  collabPosts,
  itchJamEntries,
  itchJamEntryResults,
  itchJams,
  jamWatches,
  projectTeams,
  teamMembers,
  teamProjects,
  teams,
} from "../../../src/db/schema.ts";
import {
  ARCHIVE_WARNING_DAYS,
  DAY_MS,
  EXPIRY_NUDGE_DAYS,
  POST_EXPIRY_DAYS,
  TEAM_QUIET_DAYS,
} from "../../../src/lib/collab-lifecycle.ts";
import { JAM_START_NOTICE_MS } from "../../../src/lib/jam-watch.ts";
import { db, pool } from "./db/client.ts";
import { closeQueue, notify } from "./notify.ts";

/**
 * Lifecycle sweep (every 6h) — the counterweight to the two rot vectors the
 * board and /teams discovery are exposed to: recruiting posts nobody
 * closes, and husk teams the required-team quick-create mints.
 *
 * Every step is idempotent; the stamps (`expiry_notified_at`,
 * `archive_warned_at`) and status flips carry the idempotency, so a
 * crashed run re-runs safely and a double-scheduled tick double-sends
 * nothing. The sweep is a pure reader of activity — every writer of
 * `last_activity_at` lives in the app (`touchTeamActivity`).
 */
async function main() {
  const now = new Date();
  const nudgeCutoff = new Date(now.getTime() + EXPIRY_NUDGE_DAYS * DAY_MS);
  const quietCutoff = new Date(now.getTime() - TEAM_QUIET_DAYS * DAY_MS);
  const warnedCutoff = new Date(now.getTime() - ARCHIVE_WARNING_DAYS * DAY_MS);

  // ── 0. Repair: recruiting posts with no expiry ────────────────────────────
  // The migration backfilled, and createPost stamps — but posts created in
  // the window between the two have NULL. Give them the standard window
  // from now (not createdAt: that could expire them mid-repair).
  const repaired = await db
    .update(collabPosts)
    .set({ expiresAt: new Date(now.getTime() + POST_EXPIRY_DAYS * DAY_MS) })
    .where(and(eq(collabPosts.status, "recruiting"), isNull(collabPosts.expiresAt)))
    .returning({ id: collabPosts.id });

  // ── 1. Nudge: "closes in 3 days — still looking?" ─────────────────────────
  const nudgeable = await db
    .select({
      id: collabPosts.id,
      authorId: collabPosts.authorId,
      title: collabPosts.title,
      expiresAt: collabPosts.expiresAt,
    })
    .from(collabPosts)
    .where(
      and(
        eq(collabPosts.status, "recruiting"),
        isNotNull(collabPosts.expiresAt),
        gt(collabPosts.expiresAt, now),
        lt(collabPosts.expiresAt, nudgeCutoff),
        isNull(collabPosts.expiryNotifiedAt),
      ),
    );

  let nudged = 0;
  for (const post of nudgeable) {
    // Claim the stamp first — losing a notification to a crash beats
    // double-sending it on the re-run.
    const [claimed] = await db
      .update(collabPosts)
      .set({ expiryNotifiedAt: now })
      .where(and(eq(collabPosts.id, post.id), isNull(collabPosts.expiryNotifiedAt)))
      .returning({ id: collabPosts.id });
    if (!claimed) continue;
    await notify({
      userId: post.authorId,
      type: "collab_post_expiring",
      entityType: "collab_post",
      entityId: String(post.id),
      data: { postId: post.id, postTitle: post.title, expiresAt: post.expiresAt?.toISOString() },
    });
    nudged++;
  }

  // ── 2. Expire: past-due recruiting posts ──────────────────────────────────
  const expired = await db
    .update(collabPosts)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(collabPosts.status, "recruiting"),
        isNotNull(collabPosts.expiresAt),
        lt(collabPosts.expiresAt, now),
      ),
    )
    .returning({ id: collabPosts.id, authorId: collabPosts.authorId, title: collabPosts.title });

  for (const post of expired) {
    await notify({
      userId: post.authorId,
      type: "collab_post_expired",
      entityType: "collab_post",
      entityId: String(post.id),
      data: { postId: post.id, postTitle: post.title },
    });
  }

  // ── 3 + 4 share the definition of a team the sweep may touch ──────────────
  // Never a team that shipped: a showcase project or a canonical
  // `project_teams` claim makes a team permanent history (the claim is the
  // newer signal; counting it only ever archives *fewer* teams). Never a
  // team still recruiting.
  const hasNoShowcase = notExists(
    db
      .select({ one: sql`1` })
      .from(teamProjects)
      .where(eq(teamProjects.teamId, teams.id)),
  );
  const hasNoProjectClaim = notExists(
    db
      .select({ one: sql`1` })
      .from(projectTeams)
      .where(eq(projectTeams.teamId, teams.id)),
  );
  const hasNoRecruitingPosts = notExists(
    db
      .select({ one: sql`1` })
      .from(collabPosts)
      .where(and(eq(collabPosts.teamId, teams.id), eq(collabPosts.status, "recruiting"))),
  );
  const isQuiet = lt(teams.lastActivityAt, quietCutoff);
  const sweepable = and(
    eq(teams.status, "active"),
    isQuiet,
    hasNoShowcase,
    hasNoProjectClaim,
    hasNoRecruitingPosts,
  );

  async function teamOwnerId(teamId: string): Promise<string | null> {
    const [owner] = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.role, "owner")))
      .limit(1);
    return owner?.userId ?? null;
  }

  // ── 3. Warn: quiet never-shipped teams get a 7-day heads-up ───────────────
  const warnable = await db
    .select({ id: teams.id, slug: teams.slug, name: teams.name })
    .from(teams)
    .where(and(sweepable, isNull(teams.archiveWarnedAt)));

  let warned = 0;
  for (const team of warnable) {
    const [claimed] = await db
      .update(teams)
      .set({ archiveWarnedAt: now })
      .where(and(eq(teams.id, team.id), isNull(teams.archiveWarnedAt)))
      .returning({ id: teams.id });
    if (!claimed) continue;
    const ownerId = await teamOwnerId(team.id);
    if (ownerId) {
      await notify({
        userId: ownerId,
        type: "team_archive_warning",
        entityType: "team",
        entityId: team.id,
        data: { teamId: team.id, teamSlug: team.slug, teamName: team.name },
      });
    }
    warned++;
  }

  // ── 4. Archive: warned 7d+ ago and still qualifying ───────────────────────
  // The re-check runs against the same `sweepable` predicate; a team that
  // no longer qualifies had activity (or shipped) since the warning, which
  // cancels it and clears the stamp so a future quiet spell warns afresh.
  const overdueWarned = and(eq(teams.status, "active"), lt(teams.archiveWarnedAt, warnedCutoff));

  const cancelled = await db
    .update(teams)
    .set({ archiveWarnedAt: null })
    .where(and(overdueWarned, sql`NOT (${sweepable})`))
    .returning({ id: teams.id });

  const archived = await db
    .update(teams)
    .set({ status: "archived", updatedAt: now })
    .where(and(overdueWarned, sweepable))
    .returning({ id: teams.id, slug: teams.slug, name: teams.name });

  for (const team of archived) {
    const ownerId = await teamOwnerId(team.id);
    if (ownerId) {
      await notify({
        userId: ownerId,
        type: "team_auto_archived",
        entityType: "team",
        entityId: team.id,
        data: { teamId: team.id, teamSlug: team.slug, teamName: team.name },
      });
    }
  }

  // ── 5. Jam phase notifications for watchers ───────────────────────────────
  const jamPings = await sweepJamWatches(now);

  console.log("[lifecycle-sweep] done", {
    repaired: repaired.length,
    nudged,
    expired: expired.length,
    warned,
    cancelled: cancelled.length,
    archived: archived.length,
    ...jamPings,
  });
}

/**
 * Tell watchers when a jam they follow changes phase.
 *
 * Three events, one pass, and each carries its own claimed-timestamp stamp
 * on the *watch* row — never on `itch.jams`, which the scraper owns and
 * reconciles. Claiming before sending is the same trade the expiry nudge
 * makes: losing a notification to a crash beats double-sending it on the
 * re-run, and it is what makes a double-scheduled tick harmless.
 *
 * Tombstoned jams (`missing_since`) are excluded from every query — the
 * scraper stopped finding them, so their dates are the last thing we saw
 * rather than anything true.
 */
async function sweepJamWatches(now: Date) {
  const startCutoff = new Date(now.getTime() + JAM_START_NOTICE_MS);
  const live = isNull(itchJams.missingSince);

  /** One event: which watches are due, which stamp claims them, what to send. */
  type WatchEvent = {
    stamp: "startNotifiedAt" | "votingNotifiedAt" | "resultsNotifiedAt";
    type: "jam_starting" | "jam_voting_open" | "jam_results_posted";
    due: SQL | undefined;
  };

  const events: WatchEvent[] = [
    {
      stamp: "startNotifiedAt",
      type: "jam_starting",
      due: and(
        isNotNull(itchJams.startsAt),
        gt(itchJams.startsAt, now),
        lt(itchJams.startsAt, startCutoff),
      ),
    },
    {
      // Submissions closed and a real voting window is open. A jam with no
      // `voting_ends_at` has no voting phase to announce, and inventing one
      // would ping people about nothing.
      stamp: "votingNotifiedAt",
      type: "jam_voting_open",
      due: and(
        isNotNull(itchJams.endsAt),
        lt(itchJams.endsAt, now),
        isNotNull(itchJams.votingEndsAt),
        gt(itchJams.votingEndsAt, now),
      ),
    },
    {
      // Existence of any placement row is the signal, so this fires on the
      // first sweep after the results scrape rather than on a date we would
      // otherwise have to predict.
      stamp: "resultsNotifiedAt",
      type: "jam_results_posted",
      due: sql`EXISTS (
        SELECT 1
        FROM ${itchJamEntries}
        JOIN ${itchJamEntryResults}
          ON ${itchJamEntryResults.entryId} = ${itchJamEntries.entryId}
        WHERE ${itchJamEntries.jamId} = ${itchJams.jamId}
      )`,
    },
  ];

  const sent: Record<string, number> = {};
  for (const event of events) {
    const due = await db
      .select({
        userId: jamWatches.userId,
        jamId: itchJams.jamId,
        slug: itchJams.slug,
        title: itchJams.title,
      })
      .from(jamWatches)
      .innerJoin(itchJams, eq(jamWatches.jamId, itchJams.jamId))
      .where(and(live, isNull(jamWatches[event.stamp]), event.due));

    let count = 0;
    for (const row of due) {
      const [claimed] = await db
        .update(jamWatches)
        .set({ [event.stamp]: now })
        .where(
          and(
            eq(jamWatches.userId, row.userId),
            eq(jamWatches.jamId, row.jamId),
            isNull(jamWatches[event.stamp]),
          ),
        )
        .returning({ jamId: jamWatches.jamId });
      if (!claimed) continue;
      await notify({
        userId: row.userId,
        type: event.type,
        entityType: "jam",
        entityId: String(row.jamId),
        data: { jamId: row.jamId, jamTitle: row.title, jamUrl: `/jams/${row.slug}` },
      });
      count++;
    }
    sent[event.type] = count;
  }

  return sent;
}

try {
  await main();
} finally {
  await closeQueue();
  await pool.end();
}
