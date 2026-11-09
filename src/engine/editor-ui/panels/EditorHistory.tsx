import { ArrowDown01Icon, ArrowRight01Icon, Undo02Icon } from "@hugeicons/core-free-icons";
import { useMemo, useState } from "react";

import { actorLabel, type DocOrigin, type LogEntry } from "../../collab/index";
import type { EditorSession } from "../../editor/index";
import type { EditorNotify } from "../host";
import { Badge, IconButton, Text, TimeAgo } from "../kit/index";
import { useEditorStore } from "../session/use-editor-store";
import { usePeerColor } from "./peer-faces";

/** Consecutive entries with one label and actor this close together fold into one row. */
export const HISTORY_FOLD_MS = 60_000;

const actorKey = (actor: DocOrigin): string => {
  switch (actor.kind) {
    case "user":
      return `user:${actor.userId}`;
    case "agent":
      return `agent:${actor.agentId}:${actor.onBehalfOf ?? ""}`;
    case "repair":
      return `repair:${actor.reason}`;
    default:
      return actor.kind;
  }
};

/** Newest-first entries in runs that fold: each run newest first, never empty. */
export function foldHistory(newestFirst: readonly LogEntry[]): LogEntry[][] {
  const runs: LogEntry[][] = [];
  let run: LogEntry[] | null = null;
  for (const entry of newestFirst) {
    const last: LogEntry | undefined = run?.[run.length - 1];
    if (
      run &&
      last &&
      last.label === entry.label &&
      actorKey(last.actor) === actorKey(entry.actor) &&
      last.at - entry.at <= HISTORY_FOLD_MS
    ) {
      run.push(entry);
    } else {
      run = [entry];
      runs.push(run);
    }
  }
  return runs;
}

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
  return <span className="je-history-actor je-sp-truncate">{actorLabel(actor)}</span>;
}

/** "Agent · Add 3 clouds" for an agent's entry, else the label alone. */
const rowLabel = (entry: LogEntry) =>
  entry.actor.kind === "agent" ? `Agent · ${entry.label}` : entry.label;

function Row({
  entry,
  count,
  expanded,
  onToggle,
  self,
  peerColor,
  onRevert,
  nested = false,
}: {
  entry: LogEntry;
  count: number;
  expanded: boolean;
  onToggle?: () => void;
  self: string;
  peerColor: (id: string) => string;
  onRevert: (entry: LogEntry) => void;
  nested?: boolean;
}) {
  const label = count > 1 ? `${rowLabel(entry)} ×${count}` : rowLabel(entry);
  return (
    <div className="je-history-row" data-nested={nested || undefined}>
      {onToggle ? (
        <IconButton
          size="icon-xs"
          icon={expanded ? ArrowDown01Icon : ArrowRight01Icon}
          label={expanded ? `Fold ${label}` : `Expand ${label}`}
          aria-expanded={expanded}
          cue={null}
          onClick={onToggle}
        />
      ) : null}
      <span className="je-history-line">
        {entry.actor.kind === "agent" ? (
          <Badge size="label" variant="secondary" className="je-history-agent">
            Agent
          </Badge>
        ) : null}
        <span className="je-sp-truncate je-history-label">{entry.label}</span>
        {count > 1 ? <span className="je-history-count">×{count}</span> : null}
      </span>
      <span aria-hidden className="je-history-sep">
        ·
      </span>
      <Actor entry={entry} self={self} peerColor={peerColor} />
      <span aria-hidden className="je-history-sep">
        ·
      </span>
      <span className="je-history-when">
        <TimeAgo date={new Date(entry.at)} />
      </span>
      <IconButton
        size="icon-xs"
        icon={Undo02Icon}
        label="Revert"
        className="je-history-revert"
        disabled={!entry.before}
        onClick={() => onRevert(entry)}
        tooltip={
          entry.before
            ? count > 1
              ? "Revert the newest of these"
              : "Revert"
            : "Too large to keep its undo; it can't be reverted"
        }
      />
    </div>
  );
}

/**
 * Every change to the doc, newest first, one line each: label, who made it
 * and when. Consecutive entries with the same label and actor within
 * `HISTORY_FOLD_MS` fold into one row with a count, which expands to reach
 * each. Revert applies an entry's inverse as your own change (on a folded
 * row, the newest's), so undo can take it back.
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
  const runs = useMemo(() => foldHistory([...history].reverse()), [history]);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const self = session.origin.kind === "user" ? session.origin.userId : "";

  const revert = (entry: LogEntry) => {
    const result = session.revert(entry.id);
    if (!result.ok)
      notify.error(`Couldn't revert ${entry.label}`, { description: result.issue.message });
  };

  const toggle = (key: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <section aria-label="History" className="je-scene-panel">
      {runs.length === 0 ? (
        <Text as="p" size="xs" variant="muted" className="je-scene-panel-empty">
          No changes yet.
        </Text>
      ) : (
        <ul className="je-scene-panel-scroll je-history">
          {runs.map((run) => {
            const newest = run[0]!;
            // The oldest entry stays put as newer ones join the run.
            const key = run[run.length - 1]!.id;
            const expanded = run.length > 1 && open.has(key);
            return (
              <li
                key={key}
                aria-label={
                  run.length > 1 ? `${rowLabel(newest)} ×${run.length}` : rowLabel(newest)
                }
              >
                <Row
                  entry={newest}
                  count={run.length}
                  expanded={expanded}
                  {...(run.length > 1 ? { onToggle: () => toggle(key) } : {})}
                  self={self}
                  peerColor={peerColor}
                  onRevert={revert}
                />
                {expanded ? (
                  <ul aria-label={`Each ${newest.label}`} className="je-history-each">
                    {run.map((entry) => (
                      <li key={entry.id} aria-label={rowLabel(entry)}>
                        <Row
                          entry={entry}
                          count={1}
                          expanded={false}
                          self={self}
                          peerColor={peerColor}
                          onRevert={revert}
                          nested
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
