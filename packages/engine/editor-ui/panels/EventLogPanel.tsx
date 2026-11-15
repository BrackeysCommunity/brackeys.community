import { Store } from "@tanstack/store";
import { useEffect, useMemo, useState } from "react";

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
import { useEditorPrefabs } from "../session/use-editor-store";
import { useStoreValue } from "../session/use-store-value";
import { useReplayHandle, useReplaySeek, type ReplaySource } from "./LoadRunPanel";

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

const tickOf = (text: string): number | undefined => {
  if (text.trim() === "") return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? Math.floor(n) : undefined;
};

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
 * a running replay to its tick, else selects the entity it names.
 */
export function EventLogPanel(props: {
  events: EventLog | null;
  session: EditorSession;
  notify: EditorNotify;
  /** The run loaded into the editor; its events show beside Play's. */
  run?: Store<LoadedRun | null>;
  /** What a loaded run replays against, read when one is loaded; null while it can't replay. */
  replayHost?: (run: LoadedRun) => Omit<LoadedRunReplayHost, "scene" | "prefabs"> | null;
  /** The game whose running replay a row seeks. */
  replay?: ReplaySource | null;
}) {
  const { events, session, notify, run: runStore, replayHost } = props;
  const handle = useReplayHandle(props.replay);
  const { seek } = useReplaySeek(handle, notify);
  const [noRun] = useState(() => new Store<LoadedRun | null>(null));
  const run = useStoreValue(runStore ?? noRun);
  const prefabs = useEditorPrefabs(session);
  const runLog = useMemo(() => {
    if (!run || !replayHost) return null;
    const host = replayHost(run);
    if (!host) return null;
    return loadedRunEvents(run, { ...host, scene: session.getDoc(), prefabs });
  }, [run, replayHost, session, prefabs]);

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
  const matched = useMemo(() => {
    if (!log) return [];
    const since = tickOf(from);
    const until = tickOf(to);
    const list = log.list({
      ...(since !== undefined ? { since } : {}),
      ...(type !== ALL_TYPES ? { types: [type] } : {}),
      ...(entity.trim() !== "" ? { entity: entity.trim() } : {}),
    });
    return until === undefined ? list : list.filter((e) => e.tick <= until);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the revision is the log's change signal
  }, [log, liveRevision, type, entity, from, to]);
  const shown = matched.length > EVENT_LOG_ROWS ? matched.slice(-EVENT_LOG_ROWS) : matched;

  const select = (e: StepEvent) => {
    if (handle) seek(e.tick);
    else if (e.entityId !== undefined) session.select([e.entityId]);
  };

  return (
    <section aria-label="Event log" className="je-scene-panel je-problems">
      <div className="je-panel-toolbar" role="toolbar" aria-label="Event filters">
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
          aria-label="Entity"
          placeholder="Entity"
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
        />
        <Input
          size="sm"
          type="number"
          min={0}
          aria-label="From tick"
          placeholder="From"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Input
          size="sm"
          type="number"
          min={0}
          aria-label="To tick"
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
            tooltip="Clear Play's events"
          >
            Clear
          </Button>
        ) : null}
      </div>
      {shown.length === 0 ? (
        <Text as="p" size="xs" variant="muted" className="je-scene-panel-empty">
          {all.length === 0
            ? "No events yet. Play the scene, or load a run, to log its events."
            : "No events match the filters."}
        </Text>
      ) : (
        <div className="je-scene-panel-scroll">
          {matched.length > shown.length ? (
            <Text as="p" size="xs" variant="muted" className="je-scene-panel-empty">
              The newest {shown.length} of {matched.length}.
            </Text>
          ) : null}
          <ul aria-label="Events">
            {shown.map((e, i) => (
              <EventRow
                key={`${e.tick}:${i}`}
                event={e}
                ppm={ppm}
                seeks={handle !== null}
                onSelect={select}
              />
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
  seeks,
  onSelect,
}: {
  event: StepEvent;
  ppm: number;
  seeks: boolean;
  onSelect: (e: StepEvent) => void;
}) {
  const names = [e.entityId, e.other].filter((n) => n !== undefined).join(" → ");
  const seat = e.player !== undefined ? `seat ${e.player}` : "";
  const data = dataText(e.data);
  const at = `${formatLength(e.at.x, ppm)}, ${formatLength(e.at.y, ppm)}`;
  return (
    <li aria-label={`${e.type} at tick ${e.tick}`} className="je-problems-row">
      <button
        type="button"
        disabled={!seeks && e.entityId === undefined}
        onClick={() => onSelect(e)}
        className="je-problems-show"
      >
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
      </button>
    </li>
  );
}
