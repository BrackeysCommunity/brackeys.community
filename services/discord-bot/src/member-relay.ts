import { RELAY_SIGNATURE_HEADER, signRelay } from "../../../src/lib/bot-relay-signature.ts";
import type { FetchLike } from "./api.ts";

/** The parts of a member the site mirrors. Null fields are "not known". */
export interface MemberIdentity {
  guildAvatar: string | null;
  nickname: string | null;
  avatar: string | null;
  username: string | null;
}

/**
 * Whether a gateway update is one the site should resync for. An old copy
 * that wasn't cached (a partial) can't be compared, so it counts — the
 * resync is idempotent and these events are rare.
 */
export function identityChanged(old: MemberIdentity | null, next: MemberIdentity): boolean {
  if (!old) return true;
  return (
    old.guildAvatar !== next.guildAvatar ||
    old.nickname !== next.nickname ||
    old.avatar !== next.avatar ||
    old.username !== next.username
  );
}

export interface MemberRelayOptions {
  appUrl: string;
  secret: string;
  timeoutMs?: number;
  /** A member changing avatar and nickname together arrives as several
   *  events (member and user updates); they collapse into one resync. */
  debounceMs?: number;
  fetchImpl?: FetchLike;
  log?: (line: string) => void;
}

/**
 * Tells the web app a member changed, so `/api/discord/member-sync` re-reads
 * them from Discord. Fire-and-forget: a failed relay leaves the profile as
 * stale as it was before this existed, and the next sign-in still syncs.
 */
export function createMemberRelay({
  appUrl,
  secret,
  timeoutMs = 5000,
  debounceMs = 2000,
  fetchImpl = (input, init) => fetch(input, init),
  log = () => {},
}: MemberRelayOptions) {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  async function send(discordId: string): Promise<void> {
    const body = JSON.stringify({ discordId });
    try {
      const response = await fetchImpl(
        new Request(`${appUrl}/api/discord/member-sync`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [RELAY_SIGNATURE_HEADER]: await signRelay(secret, body),
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        }),
      );
      log(`[member-relay] ${discordId} → ${response.status}`);
    } catch (error) {
      log(`[member-relay] ${discordId} failed: ${String(error)}`);
    }
  }

  return {
    relay(discordId: string): void {
      clearTimeout(pending.get(discordId));
      pending.set(
        discordId,
        setTimeout(() => {
          pending.delete(discordId);
          void send(discordId);
        }, debounceMs),
      );
    },
    stop(): void {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    },
  };
}
