/**
 * Fills `engine_releases.live_compat_key` for releases published before
 * live scenes: liveCompatKey(liveCompat(manifest)) from each stored
 * manifest. A collected release (no manifest) keeps '', which means it
 * can't take live scenes; so does a manifest that no longer parses.
 * Re-runnable: rows already holding their key are left alone.
 *
 *   bun scripts/engine/backfill-live-compat.ts --dry-run  # report only, write nothing
 *   bun scripts/engine/backfill-live-compat.ts            # apply
 */
import { liveCompat, liveCompatKey, parseReleaseManifest } from "@jams/engine/project";

export type CompatRow = {
  id: string;
  manifest: string | null;
  collectedAt: Date | null;
  liveCompatKey: string;
};

export type CompatPlan = {
  /** Rows whose stored key differs from the one their manifest gives. */
  updates: { id: string; liveCompatKey: string }[];
  /** Rows left at '' because their manifest is gone or doesn't parse. */
  empty: { id: string; reason: "collected" | "unparsable" }[];
  /** Rows already holding their key. */
  current: number;
};

/** The key a release should hold: its manifest's, or '' when it has none that parses. */
export async function compatKeyOf(
  row: Pick<CompatRow, "manifest" | "collectedAt">,
): Promise<{ key: string; reason?: "collected" | "unparsable" }> {
  if (row.collectedAt !== null || row.manifest === null) return { key: "", reason: "collected" };
  const parsed = parseReleaseManifest(row.manifest);
  if (!parsed.ok) return { key: "", reason: "unparsable" };
  return { key: await liveCompatKey(liveCompat(parsed.manifest)) };
}

export async function planLiveCompatBackfill(rows: readonly CompatRow[]): Promise<CompatPlan> {
  const plan: CompatPlan = { updates: [], empty: [], current: 0 };
  for (const row of rows) {
    const { key, reason } = await compatKeyOf(row);
    if (reason) plan.empty.push({ id: row.id, reason });
    if (key === row.liveCompatKey) plan.current++;
    else plan.updates.push({ id: row.id, liveCompatKey: key });
  }
  return plan;
}

async function main(dryRun: boolean): Promise<void> {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("@/db");
  const { engineReleases } = await import("@/db/schema");

  const rows = await db
    .select({
      id: engineReleases.id,
      manifest: engineReleases.manifest,
      collectedAt: engineReleases.collectedAt,
      liveCompatKey: engineReleases.liveCompatKey,
    })
    .from(engineReleases);
  const plan = await planLiveCompatBackfill(rows);

  const prefix = dryRun ? "[dry-run] " : "";
  for (const { id, liveCompatKey: key } of plan.updates) {
    console.log(`${prefix}${id}: ${key === "" ? "''" : key}`);
    if (!dryRun) {
      await db.update(engineReleases).set({ liveCompatKey: key }).where(eq(engineReleases.id, id));
    }
  }
  for (const { id, reason } of plan.empty) console.log(`${prefix}${id}: kept '' (${reason})`);
  console.log(
    `${dryRun ? "— dry run, nothing written —" : "— applied —"} ${rows.length} releases: ` +
      `${plan.updates.length} to update, ${plan.current} already current, ${plan.empty.length} without a key`,
  );
}

if (import.meta.main) {
  await main(process.argv.includes("--dry-run"));
  process.exit(0);
}
