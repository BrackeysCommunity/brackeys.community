import { useMemo } from "react";

import { actorLabel, type LogEntry } from "../../collab/index";
import type { EditorSession } from "../../editor/index";
import type { EditorNotify } from "../host";
import { Badge, Button, Text, TimeAgo } from "../kit/index";
import { useEditorStore } from "../session/use-editor-store";
import { usePeerColor } from "./peer-faces";

function Actor({
  entry,
  self,
  peerColor,
}: {
  entry: LogEntry;
  self: string;
  peerColor: (id: string) => string;
}) {
  const { actor } = entry;
  if (actor.kind === "user") {
    const mine = actor.userId === self;
    return (
      <span className="je-history-actor">
        <span
          aria-hidden
          className="je-history-dot"
          style={{ backgroundColor: peerColor(actor.userId) }}
        />
        <span className="je-sp-truncate">{mine ? "You" : actorLabel(actor)}</span>
      </span>
    );
  }
  return <span className="je-sp-truncate">{actorLabel(actor)}</span>;
}

/** "Agent · Add 3 clouds" for an agent's entry, else the label alone. */
const rowLabel = (entry: LogEntry) =>
  entry.actor.kind === "agent" ? `Agent · ${entry.label}` : entry.label;

/**
 * Every change to the doc, newest first, with who made it. Revert applies
 * an entry's inverse as your own change, so undo can take it back.
 */
export function EditorHistory({
  session,
  notify,
}: {
  session: EditorSession;
  notify: EditorNotify;
}) {
  const peerColor = usePeerColor();
  const history = useEditorStore(session, (s) => s.history);
  const entries = useMemo(() => [...history].reverse(), [history]);
  const self = session.origin.kind === "user" ? session.origin.userId : "";

  const revert = (entry: LogEntry) => {
    const result = session.revert(entry.id);
    if (!result.ok)
      notify.error(`Couldn't revert ${entry.label}`, { description: result.issue.message });
  };

  return (
    <section aria-label="History" className="je-scene-panel">
      <h2 className="je-scene-panel-title">History</h2>
      {entries.length === 0 ? (
        <Text as="p" size="xs" variant="muted" className="je-scene-panel-empty">
          No changes yet.
        </Text>
      ) : (
        <ul className="je-scene-panel-scroll">
          {entries.map((entry) => (
            <li key={entry.id} aria-label={rowLabel(entry)} className="je-history-row">
              <div className="je-history-body">
                <span className="je-history-line">
                  {entry.actor.kind === "agent" ? (
                    <Badge size="label" variant="secondary" className="je-history-agent">
                      Agent
                    </Badge>
                  ) : null}
                  <span className="je-sp-truncate je-history-label">{entry.label}</span>
                </span>
                <span className="je-history-meta">
                  <Actor entry={entry} self={self} peerColor={peerColor} />
                  <span aria-hidden>·</span>
                  <span className="je-history-when">
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
