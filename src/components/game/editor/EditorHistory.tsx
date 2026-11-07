import { actorLabel, type LogEntry } from "@jams/engine/collab";
import type { EditorSession } from "@jams/engine/editor";
import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TimeAgo } from "@/components/ui/time-ago";
import { Text } from "@/components/ui/typography";
import { presenceColor } from "@/lib/canvas/presence";
import { toast } from "@/lib/toast";

import { useEditorStore } from "./use-editor-store";

function Actor({ entry, self }: { entry: LogEntry; self: string }) {
  const { actor } = entry;
  if (actor.kind === "user") {
    const mine = actor.userId === self;
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: presenceColor(actor.userId).color }}
        />
        <span className="truncate">{mine ? "You" : actorLabel(actor)}</span>
      </span>
    );
  }
  return <span className="truncate">{actorLabel(actor)}</span>;
}

/** "Agent · Add 3 clouds" for an agent's entry, else the label alone. */
const rowLabel = (entry: LogEntry) =>
  entry.actor.kind === "agent" ? `Agent · ${entry.label}` : entry.label;

/**
 * Every change to the doc, newest first, with who made it. Revert applies
 * an entry's inverse as your own change, so undo can take it back.
 */
export function EditorHistory({ session }: { session: EditorSession }) {
  const history = useEditorStore(session, (s) => s.history);
  const entries = useMemo(() => [...history].reverse(), [history]);
  const self = session.origin.kind === "user" ? session.origin.userId : "";

  const revert = (entry: LogEntry) => {
    const result = session.revert(entry.id);
    if (!result.ok)
      toast.error(`Couldn't revert ${entry.label}`, { description: result.issue.message });
  };

  return (
    <section aria-label="History" className="flex min-h-0 w-full flex-col">
      <h2 className="px-2 pt-1 pb-1 text-sm font-medium">History</h2>
      {entries.length === 0 ? (
        <Text as="p" size="xs" variant="muted" className="px-2 pb-2">
          No changes yet.
        </Text>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {entries.map((entry) => (
            <li
              key={entry.id}
              aria-label={rowLabel(entry)}
              className="flex items-center gap-2 rounded-md px-2 py-1 text-xs hover:bg-muted/60"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex min-w-0 items-center gap-1.5">
                  {entry.actor.kind === "agent" ? (
                    <Badge size="label" variant="secondary" className="h-4 px-1">
                      Agent
                    </Badge>
                  ) : null}
                  <span className="truncate font-medium">{entry.label}</span>
                </span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Actor entry={entry} self={self} />
                  <span aria-hidden>·</span>
                  <span className="shrink-0">
                    <TimeAgo date={new Date(entry.at)} />
                  </span>
                </span>
              </div>
              <Button
                size="xs"
                variant="ghost"
                disabled={!entry.before}
                onClick={() => revert(entry)}
                tooltip={
                  entry.before ? undefined : "Too large to keep its undo; it can't be reverted"
                }
              >
                Revert
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
