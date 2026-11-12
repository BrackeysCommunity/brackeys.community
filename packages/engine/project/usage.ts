import type { ProjectSnapshot } from "./snapshot";
import type { AssetKey, ProjectView, Sha256 } from "./types";

export type ProjectUsage = {
  docs: number;
  docBytes: number;
  blobs: number;
  blobBytes: number;
  trashBytes: number;
};

/**
 * What a project holds, live and trashed: its asset docs (`docBytes` gives
 * each one's stored state size by key; a doc without a size counts 0) and
 * its distinct blobs, current and in hash history. `trashBytes` is what
 * emptying the trash would free: trashed docs, and blobs only trashed
 * entries hold.
 */
export function projectUsage(
  view: ProjectView,
  docBytes: ReadonlyMap<AssetKey, number>,
): ProjectUsage {
  const entries = Object.values(view.state.assets);
  const blobSize = new Map<Sha256, number>();
  const kept = new Set<Sha256>();
  const trashed = new Set<Sha256>();
  const usage: ProjectUsage = { docs: 0, docBytes: 0, blobs: 0, blobBytes: 0, trashBytes: 0 };

  for (const entry of entries) {
    const inTrash = entry.deleted !== undefined;
    if (entry.sha256 === undefined) {
      const bytes = docBytes.get(entry.key) ?? 0;
      usage.docs += 1;
      usage.docBytes += bytes;
      if (inTrash) usage.trashBytes += bytes;
      continue;
    }
    const hashes = [
      { sha256: entry.sha256, bytes: entry.bytes ?? 0 },
      ...(view.state.history[entry.key] ?? []),
    ];
    for (const { sha256, bytes } of hashes) {
      if (!blobSize.has(sha256)) blobSize.set(sha256, bytes);
      (inTrash ? trashed : kept).add(sha256);
    }
  }
  for (const [key, history] of Object.entries(view.state.history)) {
    if (view.state.assets[key]) continue;
    for (const { sha256, bytes } of history) {
      if (!blobSize.has(sha256)) blobSize.set(sha256, bytes);
      kept.add(sha256);
    }
  }

  for (const [sha256, bytes] of blobSize) {
    usage.blobs += 1;
    usage.blobBytes += bytes;
    if (trashed.has(sha256) && !kept.has(sha256)) usage.trashBytes += bytes;
  }
  return usage;
}

/**
 * Blob hashes nothing keeps: not a live or trashed entry's current hash,
 * replaced (its newest history entry) within `graceMs` of `now`, not in any pinned
 * snapshot. In `stored` order, each once. Pure; the host decides when to
 * call it and what to delete.
 */
export function unreferencedBlobs(
  view: ProjectView,
  stored: readonly Sha256[],
  opts: { now: number; graceMs: number; pinned: readonly ProjectSnapshot[] },
): Sha256[] {
  const kept = new Set<Sha256>();
  for (const entry of Object.values(view.state.assets)) {
    if (entry.sha256 !== undefined) kept.add(entry.sha256);
  }
  const since = opts.now - opts.graceMs;
  for (const history of Object.values(view.state.history)) {
    for (const h of history) if (h.at >= since) kept.add(h.sha256);
  }
  for (const snapshot of opts.pinned) {
    for (const asset of Object.values(snapshot.assets)) kept.add(asset.sha256);
  }
  const out: Sha256[] = [];
  for (const sha256 of stored) {
    if (kept.has(sha256)) continue;
    kept.add(sha256);
    out.push(sha256);
  }
  return out;
}

export type QuotaVerdict =
  | { ok: true }
  | { ok: false; limit: string; used: number; max: number; message: string };

/** Checked at blob upload and at asset-doc creation; a refusal is reported as `quota-exceeded`. */
export type QuotaPolicy = { check(usage: ProjectUsage, add: Partial<ProjectUsage>): QuotaVerdict };

/** The policy until the site states its limits: everything fits. */
export const UNLIMITED_QUOTA: QuotaPolicy = Object.freeze({
  check: (): QuotaVerdict => ({ ok: true }),
});
