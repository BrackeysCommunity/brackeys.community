import type { Document } from "@hocuspocus/server";
import { removeAwarenessStates } from "y-protocols/awareness";

import { presenceColor } from "../../../src/lib/canvas/presence.ts";
import type { SyncContext } from "./auth.ts";

/** How long a client relayed from another instance lives without a renewal. */
export const RELAYED_AWARENESS_TIMEOUT_MS = 2 * 60_000;
const CHECK_MS = 5_000;

/**
 * y-protocols drops any client 30s after its last renewal, and a hidden
 * browser tab may renew only once a minute, so peers blinked out and back.
 * Here a client lives as long as its connection: Hocuspocus removes its
 * states when the socket closes, and its own ping closes dead sockets.
 * Clients relayed from another instance have no connection here, so they
 * keep a timeout, longer than a throttled tab's renewals.
 */
export function holdAwarenessWhileConnected(
  document: Pick<Document, "awareness" | "getConnections" | "getClients">,
  options: { timeoutMs?: number; checkMs?: number; now?: () => number } = {},
): () => void {
  const { timeoutMs = RELAYED_AWARENESS_TIMEOUT_MS, checkMs = CHECK_MS, now = Date.now } = options;
  const awareness = document.awareness;
  clearInterval(
    (awareness as unknown as { _checkInterval?: ReturnType<typeof setInterval> })._checkInterval,
  );
  const timer = setInterval(() => {
    const local = new Set<number>();
    for (const connection of document.getConnections()) {
      for (const id of document.getClients(connection)) local.add(id);
    }
    const outdated: number[] = [];
    for (const [id, meta] of awareness.meta) {
      if (
        id !== awareness.clientID &&
        !local.has(id) &&
        awareness.states.has(id) &&
        now() - meta.lastUpdated >= timeoutMs
      )
        outdated.push(id);
    }
    if (outdated.length) removeAwarenessStates(awareness, outdated, "timeout");
  }, checkMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

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
