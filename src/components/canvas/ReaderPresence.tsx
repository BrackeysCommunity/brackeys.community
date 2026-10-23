import { ViewIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";

import { SimpleTooltip } from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/ui/user-avatar";
import { namesHere, presenceColor } from "@/lib/canvas/presence";

import { canvasPresenceQueryOptions } from "./canvas-queries";

const MAX_FACES = 3;
const VIEWER_KEY = "canvas-viewer-id";

let fallbackViewerId: string | null = null;

/** One id per tab, so a signed-out reader counts once however often it polls. */
function viewerId(): string {
  try {
    const stored = window.sessionStorage.getItem(VIEWER_KEY);
    if (stored) return stored;
    const id = crypto.randomUUID();
    window.sessionStorage.setItem(VIEWER_KEY, id);
    return id;
  } catch {
    fallbackViewerId ??= crypto.randomUUID();
    return fallbackViewerId;
  }
}

const viewersLabel = (n: number) => `${n} anonymous ${n === 1 ? "viewer" : "viewers"}`;

/** How many signed-out visitors are reading, beside the faces of the people here. */
export function AnonymousViewers({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <SimpleTooltip content={viewersLabel(count)}>
      <span
        role="img"
        aria-label={viewersLabel(count)}
        className="flex items-center gap-1 px-1.5 text-xs text-muted-foreground"
      >
        <HugeiconsIcon icon={ViewIcon} size={14} />
        {count}
      </span>
    </SimpleTooltip>
  );
}

/** The editor's count of signed-out viewers, which its socket can't see. */
export function EditorViewers({ canvasId }: { canvasId: string }) {
  const { data } = useQuery(canvasPresenceQueryOptions(canvasId));
  if (!data?.anonymous) return null;
  return (
    <>
      <AnonymousViewers count={data.anonymous} />
      <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
    </>
  );
}

/**
 * The editor's avatar stack for a viewer on the snapshot, read from the
 * roster instead of a socket. Signed-out visitors get a count only.
 */
export function ReaderPresence({ canvasId }: { canvasId: string }) {
  const { data } = useQuery(canvasPresenceQueryOptions(canvasId, viewerId()));
  if (!data || data.count + data.anonymous === 0) return null;

  if (data.people.length === 0) {
    const total = data.count + data.anonymous;
    return (
      <>
        <span className="px-1.5 text-xs text-muted-foreground" role="status">
          {total} {total === 1 ? "person" : "people"} here
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
      <AnonymousViewers count={data.anonymous} />
      <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
    </>
  );
}
