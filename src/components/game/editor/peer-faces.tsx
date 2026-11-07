import type { PeerPresence } from "@jams/engine/editor";

import { UserAvatar } from "@/components/ui/user-avatar";
import { presenceColor } from "@/lib/canvas/presence";

const MAX_NAME = 80;

/** A peer as the editor draws them: the colour comes from their id, never from what they sent. */
export function peerLook(peer: Pick<PeerPresence, "user">): { name: string; color: string } {
  const name = peer.user.name.trim().slice(0, MAX_NAME) || "Guest";
  return { name, color: presenceColor(peer.user.id).color };
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
  const people = distinctPeople(peers);
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const names = people.map((p) => peerLook(p).name);
  return (
    <span
      role="img"
      aria-label={`${label} ${names.join(", ")}`}
      className="flex shrink-0 items-center -space-x-1"
    >
      {shown.map((p) => {
        const { name, color } = peerLook(p);
        return (
          <span
            key={p.user.id}
            className="rounded-full"
            style={{ boxShadow: `0 0 0 2px ${color}` }}
          >
            <UserAvatar avatarUrl={null} username={name} size={size} />
          </span>
        );
      })}
      {people.length > shown.length ? (
        <span className="pl-1.5 text-xs text-muted-foreground">
          +{people.length - shown.length}
        </span>
      ) : null}
    </span>
  );
}
