import { Store } from "@tanstack/store";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import type { EntityInspection } from "../../debug/inspect";
import type { EditorSession } from "../../editor/index";
import type { JsonValue } from "../../game/types";
import { pxPerMetreOf } from "../../game/units";
import { TOOL_PRIORITY, type ToolEvent } from "../../tool-router";
import type { GameInstance, GameStoreState, Vec2 } from "../../types";
import type { EditorNotify } from "../host";
import { formatLength, formatSpeed } from "../kit/format";
import { Badge, Hotkey, Spinner, Text } from "../kit/index";
import { useEditorStore } from "../session/use-editor-store";
import { useStoreValue } from "../session/use-store-value";
import { InspectorSection } from "./inspector/field-widgets";

/** The parts of the game the play inspector reads. */
export type PlayInspectorGame = Pick<
  GameInstance,
  "debug" | "getStore" | "router" | "screenToWorld" | "registry"
>;

/** How often, at most, a play view asks the world again while frames render. */
export const PLAY_REFRESH_MS = 100;

type PickState = { id: string | null };

// Keyed by session so the outliner's Spawned group and the inspector share one pick.
const picks = new WeakMap<EditorSession, Store<PickState>>();

/**
 * The runtime entity picked in Play (a Spawned row or an Alt+click on the
 * canvas). It outranks the edit selection until the selection changes.
 */
export function playPickOf(session: EditorSession): Store<PickState> {
  let store = picks.get(session);
  if (!store) {
    store = new Store<PickState>({ id: null });
    picks.set(session, store);
  }
  return store;
}

export type LiveRead<T> =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "done"; value: T }
  | { status: "failed"; message: string };

/**
 * Reads `read()` now and again as the game's store changes (each rendered
 * frame), at most every {@link PLAY_REFRESH_MS}. Answers arrive as promises;
 * one that a newer request has overtaken is dropped. A null `key` reads nothing.
 */
export function useLiveRead<T>(
  store: Store<GameStoreState>,
  key: string | null,
  read: () => Promise<T>,
): LiveRead<T> {
  const [state, setState] = useState<LiveRead<T>>({ status: "idle" });
  const latest = useRef(read);
  latest.current = read;

  useEffect(() => {
    if (key === null) {
      setState({ status: "idle" });
      return;
    }
    let live = true;
    let seq = 0;
    let lastAt = -Infinity;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setState({ status: "pending" });

    const request = () => {
      timer = null;
      lastAt = Date.now();
      const mine = ++seq;
      latest.current().then(
        (value) => {
          if (live && mine === seq) setState({ status: "done", value });
        },
        (error: unknown) => {
          if (live && mine === seq) {
            setState({
              status: "failed",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        },
      );
    };
    const schedule = () => {
      if (timer !== null) return;
      const wait = lastAt + PLAY_REFRESH_MS - Date.now();
      if (wait <= 0) request();
      else timer = setTimeout(request, wait);
    };

    request();
    const unsubscribe = store.subscribe(schedule);
    return () => {
      live = false;
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
    };
  }, [store, key]);

  return state;
}

/** A runtime entity's row, in the outliner's look; clicking it makes it the Play pick. */
export function PlayPickRow({
  session,
  id,
  detail,
}: {
  session: EditorSession;
  id: string;
  detail?: string;
}) {
  const pick = playPickOf(session);
  const picked = useStoreValue(pick, (s) => s.id === id, Object.is);
  return (
    <button
      type="button"
      className="je-outliner-row je-play-pick-row"
      data-play-pick={id}
      data-selected={picked ? "" : undefined}
      aria-pressed={picked}
      onClick={() => pick.setState(() => ({ id }))}
    >
      <span className="je-sp-truncate">{id}</span>
      {detail !== undefined ? (
        <span className="je-insp-grow je-sp-truncate je-insp-muted">{detail}</span>
      ) : null}
    </button>
  );
}

/** One empty-state line, shared by the Play views. */
export function PlayEmpty({ children }: { children: ReactNode }) {
  return (
    <Text as="p" size="xs" variant="muted" className="je-panel-empty">
      {children}
    </Text>
  );
}

/** A Play view's line while its first read is on the way. */
export function PlayPending({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="je-insp-row je-panel-empty" data-gap="tight">
      <Spinner size={12} label={null} />
      <Text as="span" size="xs" variant="muted">
        {children}
      </Text>
    </div>
  );
}

/** Alt+click on the canvas picks the topmost entity there while this is mounted. */
function useCanvasPick(game: PlayInspectorGame, pick: Store<PickState>) {
  useEffect(() => {
    let seq = 0;
    const isPick = (e: ToolEvent) =>
      e.kind === "pointer" && e.type === "down" && e.button === 0 && e.native.altKey;
    return game.router.register({
      id: "editor-play-pick",
      priority: TOOL_PRIORITY.editor,
      accepts: isPick,
      handle(e) {
        if (e.kind !== "pointer") return;
        const at: Vec2 = game.screenToWorld(e.screen);
        const mine = ++seq;
        void game.debug.pick(at).then((id) => {
          if (mine === seq && id !== null) pick.setState(() => ({ id }));
        });
      },
    });
  }, [game, pick]);
}

/** The runtime id the inspector follows: the Play pick, else the first selected entity. */
function usePlayTarget(session: EditorSession, pick: Store<PickState>): string | null {
  const selected = useEditorStore(session, (s) => s.selection[0] ?? null);
  const picked = useStoreValue(pick, (s) => s.id, Object.is);
  const seen = useRef(selected);
  useEffect(() => {
    if (seen.current === selected) return;
    seen.current = selected;
    pick.setState(() => ({ id: null }));
  }, [selected, pick]);
  return picked ?? selected;
}

const DEG_PER_RAD = 180 / Math.PI;
const degrees = (rad: number) => `${String(Number((rad * DEG_PER_RAD).toFixed(1)) + 0)}°`;
const fixed = (n: number) => String(Number(n.toFixed(3)) + 0);

function Facts({ label, rows }: { label: string; rows: readonly [string, ReactNode][] }) {
  return (
    <dl className="je-play-facts" aria-label={label}>
      {rows.map(([term, value]) => (
        <Fragment key={term}>
          <dt>{term}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function shortJson(value: JsonValue | undefined): string {
  if (value === undefined) return "—";
  if (typeof value === "number") return fixed(value);
  return JSON.stringify(value, (_k, v: unknown) => (typeof v === "number" ? Number(fixed(v)) : v));
}

/** An `inspect` answer: an object's keys as rows, anything else as one. */
function jsonRows(value: JsonValue | undefined): [string, ReactNode][] {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value).map(([k, v]) => [k, shortJson(v)]);
  }
  return [["value", shortJson(value)]];
}

function poseRows(pose: EntityInspection["pose"], ppm: number): [string, ReactNode][] {
  if (!pose) return [["at", "No pose"]];
  return [
    ["x", formatLength(pose.x, ppm)],
    ["y", formatLength(pose.y, ppm)],
    ["rotation", degrees(pose.rot)],
  ];
}

function Inspection({
  data,
  ppm,
  session,
}: {
  data: EntityInspection;
  ppm: number;
  session: EditorSession;
}) {
  const behaviors = Object.entries(data.behaviors);
  return (
    <>
      <header className="je-insp-head">
        <span className="je-insp-title je-sp-truncate">{data.id}</span>
        <span className="je-insp-grow je-sp-truncate je-insp-muted">{data.type}</span>
        <Badge size="label" variant={data.enabled ? "secondary" : "outline"}>
          {data.enabled ? "Enabled" : "Disabled"}
        </Badge>
      </header>
      <InspectorSection id="play:pose" title="Pose">
        <Facts label="Pose" rows={poseRows(data.pose, ppm)} />
      </InspectorSection>
      <InspectorSection id="play:prev-pose" title="Previous pose" defaultOpen={false}>
        <Facts label="Previous pose" rows={poseRows(data.prevPose, ppm)} />
      </InspectorSection>
      {data.body ? (
        <InspectorSection id="play:body" title="Body">
          <Facts
            label="Body"
            rows={[
              ["velocity x", formatSpeed(data.body.velocity.x)],
              ["velocity y", formatSpeed(data.body.velocity.y)],
              ["angular", `${degrees(data.body.angular)}/s`],
              ["sleeping", data.body.sleeping ? "Yes" : "No"],
            ]}
          />
        </InspectorSection>
      ) : null}
      {data.system !== undefined ? (
        <InspectorSection id="play:system" title="System">
          <Facts label="System" rows={jsonRows(data.system)} />
        </InspectorSection>
      ) : null}
      {behaviors.length > 0 ? (
        <InspectorSection id="play:behaviors" title="Behaviors">
          {behaviors.map(([name, value]) => (
            <div key={name} className="je-insp-group" data-behavior={name}>
              <Text as="p" size="xs" variant="muted">
                {name}
              </Text>
              {value === undefined ? null : <Facts label={name} rows={jsonRows(value)} />}
            </div>
          ))}
        </InspectorSection>
      ) : null}
      <InspectorSection id="play:timers" title="Timers" defaultOpen={false}>
        {data.timers.length === 0 ? (
          <PlayEmpty>No timers</PlayEmpty>
        ) : (
          <Facts
            label="Timers"
            rows={data.timers.map((t) => [`#${t.id}`, `${t.kind}, due tick ${t.due}`])}
          />
        )}
      </InspectorSection>
      <InspectorSection id="play:contacts" title="Contacts">
        {data.contacts.length === 0 ? (
          <PlayEmpty>No contacts</PlayEmpty>
        ) : (
          <ul className="je-play-contacts" aria-label="Contacts">
            {data.contacts.map((id) => (
              <li key={id}>
                <PlayPickRow session={session} id={id} />
              </li>
            ))}
          </ul>
        )}
      </InspectorSection>
    </>
  );
}

/** The inspector during Play: the runtime entity under the selection or a canvas click, read-only. */
export function PlayInspector(props: {
  game: PlayInspectorGame;
  session: EditorSession;
  notify: EditorNotify;
}) {
  const { game, session } = props;
  const pick = playPickOf(session);
  useCanvasPick(game, pick);
  const target = usePlayTarget(session, pick);
  const read = useLiveRead(game.getStore(), target, () =>
    target === null ? Promise.resolve(null) : game.debug.inspect(target),
  );
  const ppm = pxPerMetreOf(game.registry);

  let body: ReactNode;
  if (target === null || read.status === "idle") {
    body = (
      <PlayEmpty>
        Select an entity, or <Hotkey chord="Alt" /> click one on the canvas.
      </PlayEmpty>
    );
  } else if (read.status === "pending") {
    body = <PlayPending>Reading {target}…</PlayPending>;
  } else if (read.status === "failed") {
    body = (
      <PlayEmpty>
        Couldn't read {target}: {read.message}
      </PlayEmpty>
    );
  } else if (read.value === null) {
    body = <PlayEmpty>{target} isn't live in this run.</PlayEmpty>;
  } else {
    body = <Inspection data={read.value} ppm={ppm} session={session} />;
  }
  return (
    <div className="je-inspector" aria-label="Play inspector" data-play-inspector="">
      {body}
    </div>
  );
}
