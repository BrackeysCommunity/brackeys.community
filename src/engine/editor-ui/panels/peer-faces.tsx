import { createContext, useContext } from "react";

import type { PeerPresence } from "../../editor/index";
import { defaultPeerColor } from "../host";
import { Avatar } from "../kit/index";

const MAX_NAME = 80;

const PeerColorContext = createContext<(id: string) => string>(defaultPeerColor);

/** The host's peer colours for every face, cursor and mark below it. */
export const PeerColorProvider = PeerColorContext.Provider;

/** The peer colour function in effect: the host's, or `defaultPeerColor`. */
export function usePeerColor(): (id: string) => string {
  return useContext(PeerColorContext);
}

/** A peer as the editor draws them: the colour comes from their id, never from what they sent. */
export function peerLook(
  peer: Pick<PeerPresence, "user">,
  peerColor: (id: string) => string = defaultPeerColor,
): { name: string; color: string } {
  const name = peer.user.name.trim().slice(0, MAX_NAME) || "Guest";
  return { name, color: peerColor(peer.user.id) };
}

/** Each person once, in client order: one person in two tabs is one face. */
export function distinctPeople(peers: readonly PeerPresence[]): PeerPresence[] {
  const seen = new Set<string>();
  return peers.filter((p) => {
    if (seen.has(p.user.id)) return false;
    seen.add(p.user.id);
    return true;
  });
}

/** Overlapping initials ringed in each person's colour, labelled with their names. */
export function PeerFaces({
  peers,
  label,
  size = 16,
  max = 3,
}: {
  peers: readonly PeerPresence[];
  /** Read before the names, as in "Selected by". */
  label: string;
  size?: number;
  max?: number;
}) {
  const peerColor = usePeerColor();
  const people = distinctPeople(peers);
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const names = people.map((p) => peerLook(p, peerColor).name);
  return (
    <span role="img" aria-label={`${label} ${names.join(", ")}`} className="je-peer-faces">
      {shown.map((p) => {
        const { name, color } = peerLook(p, peerColor);
        return (
          <span key={p.user.id} className="je-peer-face" aria-hidden>
            <Avatar name={name} size={size} ring={color} />
          </span>
        );
      })}
      {people.length > shown.length ? (
        <span className="je-peer-more">+{people.length - shown.length}</span>
      ) : null}
    </span>
  );
}
