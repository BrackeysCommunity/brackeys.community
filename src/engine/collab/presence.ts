import { PRESENCE_FIELD, type AwarenessLike, type ScenePresence } from "./types";

/** Publishes this client's presence, merged over what it published before. */
export function setPresence(awareness: AwarenessLike, patch: Partial<ScenePresence>): void {
  const prev = (awareness.getLocalState()?.[PRESENCE_FIELD] ?? {}) as Partial<ScenePresence>;
  awareness.setLocalStateField(PRESENCE_FIELD, { ...prev, ...patch });
}

export type PeerPresence = ScenePresence & { clientId: number };

const isPresence = (v: unknown): v is ScenePresence =>
  v !== null &&
  typeof v === "object" &&
  typeof (v as ScenePresence).user?.id === "string" &&
  Array.isArray((v as ScenePresence).selection);

/** Everyone else's presence, ordered by client id. */
export function peers(awareness: AwarenessLike): PeerPresence[] {
  const out: PeerPresence[] = [];
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === awareness.clientID) continue;
    const p = state[PRESENCE_FIELD];
    if (isPresence(p)) out.push({ ...p, clientId });
  }
  return out.sort((a, b) => a.clientId - b.clientId);
}

/** Calls back with the peers whenever anyone's presence changes. Returns the unsubscribe. */
export function observePeers(
  awareness: AwarenessLike,
  cb: (peers: PeerPresence[]) => void,
): () => void {
  const handler = () => cb(peers(awareness));
  awareness.on("change", handler);
  return () => awareness.off("change", handler);
}

/** Which peers have each key selected, for the outliner and canvas highlights. */
export function selectionsByKey(list: readonly PeerPresence[]): Map<string, PeerPresence[]> {
  const out = new Map<string, PeerPresence[]>();
  for (const p of list) {
    for (const key of p.selection) {
      const at = out.get(key);
      if (at) at.push(p);
      else out.set(key, [p]);
    }
  }
  return out;
}
