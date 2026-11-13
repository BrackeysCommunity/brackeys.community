import { signCanvasToken } from "@/lib/canvas/token";

export const PLAYER_TOKEN_TTL_MS = 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A signed-out player's key, `anon:<lowercased uuid>`; null unless `anonId` is a UUID. */
export const anonPlayerKey = (anonId: string | undefined): string | null =>
  anonId !== undefined && UUID.test(anonId) ? `anon:${anonId.toLowerCase()}` : null;

/**
 * A player's sync token: 60 seconds, `k: "session"`, `c: "session:<id>"`,
 * write access and `r: "player"`, so it opens one game session and every
 * other kind refuses it. `userId` null mints for the browser's anonymous id
 * (`anonId`, a UUID the browser keeps), as `u: "anon:<uuid>"`.
 */
export async function mintPlayerToken(opts: {
  sessionId: string;
  userId: string | null;
  anonId?: string;
  name?: string;
  now?: number;
}): Promise<string> {
  const secret = process.env.CANVAS_SYNC_SECRET;
  if (!secret) throw new Error("Live sessions aren't set up here.");
  if (!opts.sessionId) throw new Error("A player token needs a session id.");
  const user = opts.userId ?? anonPlayerKey(opts.anonId);
  if (user === null) throw new Error("A signed-out player needs this browser's anonymous id.");
  return signCanvasToken(
    {
      c: `session:${opts.sessionId}`,
      u: user,
      a: "write",
      k: "session",
      r: "player",
      ...(opts.name !== undefined ? { n: opts.name } : {}),
    },
    secret,
    opts.now ?? Date.now(),
    PLAYER_TOKEN_TTL_MS,
  );
}
