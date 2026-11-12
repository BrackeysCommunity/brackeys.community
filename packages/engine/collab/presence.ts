import { PRESENCE_FIELD, type AwarenessLike, type ScenePresence } from "./types";

export type Peer<T> = T & { clientId: number };

export interface PresenceChannel<T extends object> {
  /** Publishes this client's state, merged over what it published before. */
  set(awareness: AwarenessLike, patch: Partial<T>): void;
  /** Everyone else's state, ordered by client id. */
  peers(awareness: AwarenessLike): Peer<T>[];
  /** Calls back with the peers whenever anyone's awareness changes. Returns the unsubscribe. */
  observe(awareness: AwarenessLike, cb: (peers: Peer<T>[]) => void): () => void;
}

/** One presence shape kept under its own awareness field; states failing `guard` are skipped. */
export function presenceChannel<T extends object>(
  field: string,
  guard: (v: unknown) => v is T,
): PresenceChannel<T> {
  const peers = (awareness: AwarenessLike): Peer<T>[] => {
    const out: Peer<T>[] = [];
    for (const [clientId, state] of awareness.getStates()) {
      if (clientId === awareness.clientID) continue;
      const p = state[field];
      if (guard(p)) out.push({ ...p, clientId });
    }
    return out.sort((a, b) => a.clientId - b.clientId);
  };
  return {
    set(awareness, patch) {
      const prev = (awareness.getLocalState()?.[field] ?? {}) as Partial<T>;
      awareness.setLocalStateField(field, { ...prev, ...patch });
    },
    peers,
    observe(awareness, cb) {
      const handler = () => cb(peers(awareness));
      awareness.on("change", handler);
      return () => awareness.off("change", handler);
    },
  };
}

export type PeerPresence = ScenePresence & { clientId: number };

const scene = presenceChannel(
  PRESENCE_FIELD,
  (v: unknown): v is ScenePresence =>
    v !== null &&
    typeof v === "object" &&
    typeof (v as ScenePresence).user?.id === "string" &&
    Array.isArray((v as ScenePresence).selection),
);

/** Publishes this client's presence, merged over what it published before. */
export function setPresence(awareness: AwarenessLike, patch: Partial<ScenePresence>): void {
  scene.set(awareness, patch);
}

/** Everyone else's presence, ordered by client id. */
export function peers(awareness: AwarenessLike): PeerPresence[] {
  return scene.peers(awareness);
}

/** Calls back with the peers whenever anyone's presence changes. Returns the unsubscribe. */
export function observePeers(
  awareness: AwarenessLike,
  cb: (peers: PeerPresence[]) => void,
): () => void {
  return scene.observe(awareness, cb);
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
