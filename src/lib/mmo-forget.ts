import { createHash, randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { account } from "@/db/schema";
import { env } from "@/env";
import { worldPost } from "@/lib/mmo-map/world";

import type { ForgetReply, ForgetRequest } from "../../packages/mmo-api/src/index.ts";
import { PathForget } from "../../packages/mmo-api/src/index.ts";

/** The site may ask the world to forget a player only with a world and the forget token. */
export function forgetEnabled(): boolean {
  return Boolean(env.MMO_WORLD_URL && env.MMO_FORGET_TOKEN);
}

/** A world that would not forget; the message names the status and the world's code, never the token. */
export class ForgetError extends Error {
  constructor(
    readonly status: number,
    readonly code = "",
  ) {
    super(`the world did not forget the player: ${status}${code ? ` ${code}` : ""}`);
    this.name = "ForgetError";
  }
}

/**
 * Asks the world to forget the character of a Discord user (GDD 14.9). The
 * key is the request's interaction id, so asking again with it writes once.
 * Throws unless the world answered that it took the request.
 */
export async function forgetGameData(discordId: string, key: string): Promise<ForgetReply> {
  const token = env.MMO_FORGET_TOKEN;
  if (!forgetEnabled() || !token) throw new Error("MMO_WORLD_URL or MMO_FORGET_TOKEN is not set");
  const body: ForgetRequest = { interactionId: key, discordId };
  let res: Response;
  try {
    res = await worldPost(PathForget, token, body);
  } catch {
    throw new ForgetError(0, "unavailable");
  }
  if (res.status !== 200) {
    let code = "";
    try {
      code = ((await res.json()) as { code?: string } | null)?.code ?? "";
    } catch {
      // A refusal without a JSON body still has its status.
    }
    throw new ForgetError(res.status, code);
  }
  return (await res.json()) as ForgetReply;
}

/** The user's linked Discord account id, which keys their character in the world. */
export async function discordAccountOf(userId: string): Promise<string | undefined> {
  const rows = await db
    .select({ accountId: account.accountId })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "discord")))
    .limit(1);
  return rows[0]?.accountId || undefined;
}

function userHash(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 16);
}

/** One key per account deletion, so a retried deletion forgets once. */
export function deletionForgetKey(userId: string): string {
  return `site-forget-${userHash(userId)}`;
}

/**
 * A fresh key per request from settings: a player who forgets, plays again
 * and forgets again must reach the new character, not repeat the first.
 */
export function settingsForgetKey(userId: string): string {
  return `site-forget-${userHash(userId)}-${randomUUID()}`;
}

export interface GameDataStatus {
  /** The site can reach the world's forget path and the user has a Discord account linked. */
  shown: boolean;
}

export const GAME_DATA_HIDDEN: GameDataStatus = { shown: false };

/** Whether the privacy settings offer the user to forget their game data. */
export async function gameDataStatus(userId: string | undefined): Promise<GameDataStatus> {
  if (!userId || !forgetEnabled()) return GAME_DATA_HIDDEN;
  return { shown: Boolean(await discordAccountOf(userId)) };
}

/** Forgets the user's game data on its own, keeping the site account. */
export async function forgetUserGameData(userId: string): Promise<ForgetReply> {
  const discordId = await discordAccountOf(userId);
  if (!discordId) throw new Error("No Discord account is linked");
  return forgetGameData(discordId, settingsForgetKey(userId));
}
