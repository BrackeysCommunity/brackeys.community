import { presenceChannel } from "./presence";
import { PROJECT_PRESENCE_FIELD, type AwarenessLike, type ProjectPresence } from "./types";

export type ProjectPeer = ProjectPresence & { clientId: number };

const project = presenceChannel(
  PROJECT_PRESENCE_FIELD,
  (v: unknown): v is ProjectPresence =>
    v !== null &&
    typeof v === "object" &&
    typeof (v as ProjectPresence).user?.id === "string" &&
    ((v as ProjectPresence).doc === null || typeof (v as ProjectPresence).doc === "string"),
);

/** Publishes where this client is in the project, merged over what it published before. */
export function setProjectPresence(
  awareness: AwarenessLike,
  patch: Partial<ProjectPresence>,
): void {
  project.set(awareness, patch);
}

/** Everyone else's project presence, ordered by client id. */
export function projectPeers(awareness: AwarenessLike): ProjectPeer[] {
  return project.peers(awareness);
}

/** Calls back with the project peers whenever anyone's presence changes. Returns the unsubscribe. */
export function observeProjectPeers(
  awareness: AwarenessLike,
  cb: (peers: ProjectPeer[]) => void,
): () => void {
  return project.observe(awareness, cb);
}

/** Which peers are in each doc, for the project tree; `null` holds those on the overview. */
export function projectPeersByDoc(list: readonly ProjectPeer[]): Map<string | null, ProjectPeer[]> {
  const out = new Map<string | null, ProjectPeer[]>();
  for (const p of list) {
    const at = out.get(p.doc);
    if (at) at.push(p);
    else out.set(p.doc, [p]);
  }
  return out;
}
