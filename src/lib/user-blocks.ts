import { and, eq, or } from "drizzle-orm";

import { db } from "@/db";
import { userBlocks } from "@/db/schema";

/**
 * Whether a block exists in either direction between two users.
 *
 * Callers refusing an action on a block must use a neutral message that
 * never reveals the block's direction (or that a block exists at all,
 * where the surface allows it).
 */
export async function blockPairExists(a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ blockerId: userBlocks.blockerId })
    .from(userBlocks)
    .where(
      or(
        and(eq(userBlocks.blockerId, a), eq(userBlocks.blockedId, b)),
        and(eq(userBlocks.blockerId, b), eq(userBlocks.blockedId, a)),
      ),
    )
    .limit(1);
  return Boolean(row);
}
