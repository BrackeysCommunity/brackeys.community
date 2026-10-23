import { useQuery } from "@tanstack/react-query";

import { SimpleTooltip } from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/ui/user-avatar";
import { namesHere, presenceColor } from "@/lib/canvas/presence";

import { canvasPresenceQueryOptions } from "./canvas-queries";

const MAX_FACES = 3;

/**
 * The editor's avatar stack for a viewer on the snapshot, read from the
 * roster instead of a socket. Signed-out visitors get a count only.
 */
export function ReaderPresence({ canvasId }: { canvasId: string }) {
  const { data } = useQuery(canvasPresenceQueryOptions(canvasId));
  if (!data || data.count === 0) return null;

  if (data.people.length === 0) {
    return (
      <>
        <span className="px-1.5 text-xs text-muted-foreground" role="status">
          {data.count} {data.count === 1 ? "person" : "people"} here
        </span>
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
      </>
    );
  }

  const shown = data.people.slice(0, MAX_FACES);
  const more = data.people.length - shown.length;
  const names = namesHere(data.people.map((p) => p.displayName));
  return (
    <>
      <SimpleTooltip content={`${names} ${data.people.length === 1 ? "is" : "are"} here`}>
        <div
          role="group"
          aria-label={`People here: ${names}`}
          className="flex items-center -space-x-1.5 px-1"
        >
          {shown.map((person) => (
            <span
              key={person.userId}
              className="rounded-full"
              style={{ boxShadow: `0 0 0 2px ${presenceColor(person.userId).color}` }}
            >
              <UserAvatar avatarUrl={person.avatarUrl} username={person.displayName} size={24} />
            </span>
          ))}
          {more > 0 ? <span className="pl-2.5 text-xs text-muted-foreground">+{more}</span> : null}
        </div>
      </SimpleTooltip>
      <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
    </>
  );
}
