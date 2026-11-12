// Keeping a signed-out player's saves after sign-in: which of this
// browser's saves to offer and tick, and moving the ticked ones to the
// account. The play page's dialog and the play smoke's host page both claim
// through here.

import type { SaveLimits, SaveStore, SaveSummary } from "@jams/engine";

/** One save this browser holds, as the dialog offers it. */
export type ClaimRow = {
  slot: string;
  /** This browser's save: its title, scene and date. */
  local: SaveSummary;
  /** The account's save in the same slot, for its date, or null. */
  account: SaveSummary | null;
  /** The account already holds this slot; uploading replaces its save. */
  collides: boolean;
  /** Offered ticked: up to the account's free slots, never a colliding one. */
  ticked: boolean;
};

export type ClaimResult = { slot: string; ok: true } | { slot: string; ok: false; message: string };

/** A ticked save that vanished from this browser before it could be uploaded. */
export const CLAIM_GONE_MESSAGE = "This save is no longer in this browser.";

/** This browser's saves as the dialog's rows, in the order it lists them. */
export function planClaim(
  local: readonly SaveSummary[],
  account: readonly SaveSummary[],
  limits: SaveLimits,
): ClaimRow[] {
  const held = new Map(account.map((save) => [save.slot, save]));
  let free = Math.max(0, limits.maxSlots - held.size);
  return local.map((save) => {
    const onAccount = held.get(save.slot) ?? null;
    const collides = onAccount !== null;
    const ticked = !collides && free > 0;
    if (ticked) free -= 1;
    return { slot: save.slot, local: save, account: onAccount, collides, ticked };
  });
}

/**
 * Uploads each ticked row's save through the site store, the same write
 * (caps and rate limit) as any other. An uploaded save leaves this browser;
 * a refused one stays, with the refusal's message. Rows go one at a time,
 * in order, so the account's slot count is judged after each upload.
 */
export async function claimSaves(
  rows: readonly ClaimRow[],
  local: SaveStore,
  site: SaveStore,
  gameId: string,
): Promise<ClaimResult[]> {
  const results: ClaimResult[] = [];
  for (const row of rows) {
    if (!row.ticked) continue;
    const text = await local.read(gameId, row.slot);
    if (text === null) {
      results.push({ slot: row.slot, ok: false, message: CLAIM_GONE_MESSAGE });
      continue;
    }
    const written = await site.write(gameId, row.slot, text);
    if (!written.ok) {
      results.push({ slot: row.slot, ok: false, message: written.issue.message });
      continue;
    }
    await local.remove(gameId, row.slot);
    results.push({ slot: row.slot, ok: true });
  }
  return results;
}
