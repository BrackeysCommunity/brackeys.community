import { UserAvatar } from "@/components/ui/user-avatar";
import { namesHere } from "@/lib/canvas/presence";
import { cn } from "@/lib/utils";

import type { LiveCanvas } from "./canvas-queries";

const MAX_FACES = 3;

/** "Mara and Rin are here", with their faces, for a canvas others have open. */
export function PeopleHere({
  people,
  className,
}: {
  people: LiveCanvas["people"];
  className?: string;
}) {
  if (people.length === 0) return null;
  const names = namesHere(people.map((p) => p.displayName));
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <span className="flex shrink-0 -space-x-1.5" aria-hidden>
        {people.slice(0, MAX_FACES).map((person) => (
          <UserAvatar
            key={person.userId}
            avatarUrl={person.avatarUrl}
            username={person.displayName}
            size={18}
            className="ring-2 ring-card"
          />
        ))}
      </span>
      <span className="truncate text-xs text-foreground">
        {names} {people.length === 1 ? "is" : "are"} here
      </span>
    </span>
  );
}
