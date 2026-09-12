import { ORPCError } from "@orpc/client";

import { sealToken } from "@/lib/token-crypto";

/**
 * `sealToken` for the link handlers. It throws a plain `Error` when the
 * encryption key is missing in production or malformed anywhere, and a
 * plain throw inside a handler is an opaque "Internal server error" —
 * which is what both GitHub and itch.io linking showed on staging, for
 * one shared cause that nothing named.
 */
export function sealLinkedAccountToken(token: string): string {
  try {
    return sealToken(token);
  } catch (err) {
    console.error("[linked-accounts] cannot seal token:", err);
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message:
        "Account linking is not configured on this server (the token encryption key is missing or invalid). Please let staff know.",
    });
  }
}
