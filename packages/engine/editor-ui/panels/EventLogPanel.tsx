import { Store } from "@tanstack/store";
import { useEffect, useMemo, useRef, useState } from "react";

import type { EventLog } from "../../debug/event-log";
import type { EditorSession } from "../../editor/index";
import { pxPerMetreOf } from "../../game/units";
import type { StepEvent } from "../../runtime/types";
import type { EditorNotify } from "../host";
import { formatLength } from "../kit/format";
import {
  Button,
  Input,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
} from "../kit/index";
import { loadedRunEvents, type LoadedRun, type LoadedRunReplayHost } from "../session/loaded-run";
import { useEditorDoc, useEditorPrefabs } from "../session/use-editor-store";
import { useStoreValue } from "../session/use-store-value";
import { useReplayHandle, useReplaySeek, type ReplaySource } from "./LoadRunPanel";
import { playPickOf } from "./PlayInspector";
import { isSpawnedId } from "./SpawnedGroup";

/** Rows the panel draws at most: the newest of what the filters match. */
export const EVENT_LOG_ROWS = 500;
/** How long the panel gathers a running log's ticks before it draws them again. */
const REDRAW_MS = 100;
const ALL_TYPES = "*";

type Source = "play" | "run";

/** Redraws when `log` takes events or clears, at most every `REDRAW_MS`. */
function useLogRevision(log: EventLog | null): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!log) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = log.subscribe(() => {
      timer ??= setTimeout(() => {
        timer = null;
        setRevision((r) => r + 1);
      }, REDRAW_MS);
    });
    return () => {
      off();
      if (timer) clearTimeout(timer);
    };
  }, [log]);
  return revision;
}

/**
 * A React key per event that holds while the newest-N window slides, so a
 * focused row keeps its node. Events are kept by identity, so the key is
 * the order the panel first saw each one in.
 */
function useEventKeys(): (e: StepEvent) => number {
  const keys = useRef<{ next: number; of: WeakMap<StepEvent, number> } | null>(null);
  keys.current ??= { next: 0, of: new WeakMap() };
  const held = keys.current;
  return (e) => {
    let key = held.of.get(e);
    if (key === undefined) {
      key = held.next++;
      held.of.set(e, key);
    }
    return key;
  };
}

/** A typed tick bound; ticks start at 0, so a negative one reads as 0. */
const tickOf = (text: string): number | undefined => {
  if (text.trim() === "") return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : undefined;
};

/** What a loaded run replays against, but the scene and prefabs, which the panel reads from the session. */
export type EventLogReplayHost = Omit<LoadedRunReplayHost, "scene" | "prefabs">;

/**
 * The loaded run's log, replayed after the panel paints rather than during
 * render, and again whenever the run, the scene, its prefabs or `host` change.
 */
function useLoadedRunLog(
  run: LoadedRun | null,
  host: EventLogReplayHost | null | undefined,
  session: EditorSession,
): EventLog | null {
  const scene = useEditorDoc(session);
  const prefabs = useEditorPrefabs(session);
  const [replayed, setReplayed] = useState<{ run: LoadedRun; log: EventLog | null } | null>(null);
  useEffect(() => {
    if (!run || !host) return;
    let live = true;
    const timer = setTimeout(() => {
      const log = loadedRunEvents(run, { ...host, scene, prefabs });
      if (live) setReplayed({ run, log });
    }, 0);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [run, host, scene, prefabs]);
  return run && host && replayed?.run === run ? replayed.log : null;
}

/** A payload as one line of JSON: event data is plain data. */
function dataText(data: unknown): string | null {
  if (data === undefined) return null;
  try {
    return JSON.stringify(data) ?? null;
  } catch {
    return null;
  }
}

/**
 * Play's and a replay's step events, and a loaded run's from replaying it
 * headless here once, filtered by type, entity and tick range. A row seeks
 * a running replay to its tick, else picks the entity it names: for the
 * play inspector in Play, else in the edit selection.
 */
export function EventLogPanel(props: {
  events: EventLog | null;
  session: EditorSession;
  notify: EditorNotify;
  /** The run loaded into the editor; its events show beside Play's. */
  run?: Store<LoadedRun | null>;
  /** What a loaded run replays against; keep it the same object until one of its parts changes. */
  replayHost?: EventLogReplayHost | null;
  /** The game whose running replay a row seeks. */
  replay?: ReplaySource | null;
  /** Whether the scene is in Play, where a row picks its entity for the play inspector. */
  playing?: boolean;
}) {
  const { events, session, notify, run: runStore, replayHost, playing = false } = props;
  const handle = useReplayHandle(props.replay);
  const { seek } = useReplaySeek(handle, notify);
  const [noRun] = useState(() => new Store<LoadedRun | null>(null));
  const run = useStoreValue(runStore ?? noRun);
  const runLog = useLoadedRunLog(run, replayHost, session);

  const liveRevision = useLogRevision(events);
  const [picked, setPicked] = useState<Source | null>(null);
  const liveHas = events !== null && events.list({ limit: 1 }).length > 0;
  const source: Source =
    picked === "run" && runLog ? "run" : picked === "play" || liveHas || !runLog ? "play" : "run";
  const log = source === "run" ? runLog : events;

  const [type, setType] = useState(ALL_TYPES);
  const [entity, setEntity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const ppm = pxPerMetreOf(session.registry);

  const all = useMemo(
    () => log?.list() ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the revision is the log's change signal
    [log, liveRevision],
  );
  const types = useMemo(() => [...new Set(all.map((e) => e.type))].sort(), [all]);
  const since = tickOf(from);
  const until = tickOf(to);
  const backwards = since !== undefined && until !== undefined && since > until;
  const matched = useMemo(() => {
    if (!log) return [];
    const list = log.list({
      ...(since !== undefined ? { since } : {}),
      ...(type !== ALL_TYPES ? { types: [type] } : {}),
      ...(entity.trim() !== "" ? { entity: entity.trim() } : {}),
    });
    return until === undefined ? list : list.filter((e) => e.tick <= until);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the revision is the log's change signal
  }, [log, liveRevision, type, entity, since, until]);
  const shown = matched.length > EVENT_LOG_ROWS ? matched.slice(-EVENT_LOG_ROWS) : matched;
  const keyOf = useEventKeys();

  /** What clicking the row does; null for a row that does nothing. */
  const actionOf = (e: StepEvent): (() => void) | null => {
    if (handle) return () => seek(e.tick);
    const id = e.entityId;
    if (id === undefined) return null;
    if (playing) return () => playPickOf(session).setState(() => ({ id }));
    // A runtime spawn has no document entity to select outside Play.
    return isSpawnedId(id) ? null : () => session.select([id]);
  };

  return (
    <section aria-label="Event log" className="je-scene-panel je-problems">
      <div className="je-panel-toolbar je-event-filters" role="toolbar" aria-label="Event filters">
        {runLog && run ? (
          <SegmentedControl
            size="xs"
            value={source}
            onChange={(v) => setPicked(v as Source)}
            aria-label="Events of"
          >
            <SegmentedControl.Item value="play">Play</SegmentedControl.Item>
            <SegmentedControl.Item value="run">{run.name}</SegmentedControl.Item>
          </SegmentedControl>
        ) : null}
        <Select value={type} onValueChange={(v) => setType(String(v ?? ALL_TYPES))}>
          <SelectTrigger size="sm" aria-label="Event type">
            <SelectValue>{type === ALL_TYPES ? "All types" : type}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TYPES}>All types</SelectItem>
            {types.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          size="sm"
          className="je-event-entity"
          aria-label="Entity"
          placeholder="Entity"
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
        />
        <Input
          size="sm"
          type="number"
          min={0}
          className="je-event-tick"
          aria-label="From tick"
          aria-invalid={backwards || undefined}
          placeholder="From"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Input
          size="sm"
          type="number"
          min={0}
          className="je-event-tick"
          aria-label="To tick"
          aria-invalid={backwards || undefined}
          placeholder="To"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        {source === "play" && events ? (
          <Button
            size="xs"
            variant="ghost"
            disabled={!liveHas}
            onClick={() => events.clear()}
            tooltip="Clear Play's events (can't be undone)"
          >
            Clear
          </Button>
        ) : null}
      </div>
      {shown.length === 0 ? (
        <Text as="p" size="xs" variant="muted" className="je-panel-empty">
          {all.length === 0
            ? "No events yet. Play the scene, or load a run, to log its events."
            : backwards
              ? "From is after To: no tick is in that range."
              : "No events match the filters."}
        </Text>
      ) : (
        <div className="je-scene-panel-scroll">
          {matched.length > shown.length ? (
            <Text as="p" size="xs" variant="muted" className="je-event-truncated">
              The newest {shown.length} of {matched.length}.
            </Text>
          ) : null}
          <ul aria-label="Events">
            {shown.map((e) => (
              <EventRow key={keyOf(e)} event={e} ppm={ppm} onClick={actionOf(e)} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function EventRow({
  event: e,
  ppm,
  onClick,
}: {
  event: StepEvent;
  ppm: number;
  onClick: (() => void) | null;
}) {
  const names = [e.entityId, e.other].filter((n) => n !== undefined).join(" → ");
  const seat = e.player !== undefined ? `seat ${e.player}` : "";
  const data = dataText(e.data);
  const at = `${formatLength(e.at.x, ppm)}, ${formatLength(e.at.y, ppm)}`;
  const content = (
    <>
      <span className="je-run-marker-at">{e.tick}</span>
      <span className="je-problems-text">
        <span className="je-problems-message">
          {e.type}
          {names ? ` · ${names}` : ""}
          {seat ? ` · ${seat}` : ""}
          {data ? ` · ${data}` : ""}
        </span>{" "}
        <span className="je-problems-code">{at}</span>
      </span>
    </>
  );
  return (
    <li
      aria-label={`${e.type} at tick ${e.tick}`}
      className="je-problems-row"
      data-inert={onClick ? undefined : ""}
    >
      {onClick ? (
        <button type="button" onClick={onClick} className="je-problems-show">
          {content}
        </button>
      ) : (
        <div className="je-problems-show">{content}</div>
      )}
    </li>
  );
}
