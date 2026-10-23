import { presenceColor } from "../../../src/lib/canvas/presence.ts";
import type { SyncContext } from "./auth.ts";

/**
 * Pins what a connection publishes in awareness to who its token says it
 * is. Peers draw names, avatars and caret colors straight from `user`, so
 * a writer could otherwise appear as someone else or style another
 * person's caret. A state for a client id another connection here owns is
 * dropped rather than overwritten.
 */
export function pinAwareness(
  states: Map<number, Record<string, unknown>>,
  context: Pick<SyncContext, "userId" | "name" | "avatarUrl">,
  ownedElsewhere: ReadonlySet<number>,
): void {
  for (const [clientId, state] of states) {
    if (ownedElsewhere.has(clientId)) {
      states.delete(clientId);
      continue;
    }
    const sent =
      typeof state.user === "object" && state.user !== null
        ? (state.user as Record<string, unknown>)
        : {};
    const face =
      context.name !== undefined
        ? { name: context.name, avatarUrl: context.avatarUrl ?? null }
        : { name: sent.name, avatarUrl: sent.avatarUrl };
    states.set(clientId, {
      ...state,
      user: { ...face, id: context.userId, ...presenceColor(context.userId) },
    });
  }
}
