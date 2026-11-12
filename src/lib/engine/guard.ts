import { deployEnv } from "@/lib/deploy-env";

/**
 * Whether this deployment may host games at all. False on production until
 * the owner's gates before production are met (the play domain, the CDN,
 * storage, moderation, legal review); remove this line then. Client-safe:
 * the legal pages render by it.
 */
export function engineGamesAllowed(): boolean {
  return deployEnv() !== "production";
}
