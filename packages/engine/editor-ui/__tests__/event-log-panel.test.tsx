// @vitest-environment jsdom
import { Store } from "@tanstack/store";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { loadCompatRapier } from "../../__tests__/fixtures/compat-rapier";
import { testGame } from "../../__tests__/fixtures/test-game";
import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../collab/index";
import { createEventLog } from "../../debug/event-log";
import type { EntityInspection } from "../../debug/inspect";
import { createEditorSession, type SceneDefinition } from "../../editor/index";
import { createRegistry } from "../../game/index";
import type { replayRecording } from "../../headless/index";
import { runPlaytest } from "../../headless/playtest";
import type { StepEvent } from "../../runtime/types";
import { parseSceneOrThrow } from "../../scene/parse";
import engineYardJson from "../../scenes/engine-yard.json";
import type { GameStoreState } from "../../types";
import type { EditorNotify } from "../host";
import { KitProvider } from "../kit/index";
import { EventLogPanel } from "../panels/EventLogPanel";
import { PlayInspector, type PlayInspectorGame } from "../panels/PlayInspector";
import { loadedRunEvents, type LoadedRun } from "../session/loaded-run";
import { fakeGameDebug } from "./fake-world-game";

const notify: EditorNotify = Object.assign(vi.fn(), {
  error: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
});
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };

function sessionOf() {
  const def: SceneDefinition = {
    v: 1,
    name: "log-yard",
    bounds: [0, 0, 2000, 1200],
    solid: [["box", 1000, 1180, 1000, 20]],
    entities: [
      { id: "zone", type: "sensor", shape: ["circle", 900, 600, 12], tags: ["goal"] },
      { id: "pad", type: "marker", at: [1000, 1010] },
    ],
  };
  return createEditorSession({
    doc: sceneToDoc(def, { key: sequentialKeys("t") }),
    origin: ada,
    name: def.name,
    registry: createRegistry(),
    issuesDebounceMs: 0,
  });
}

const ev = (tick: number, type: string, more: Partial<StepEvent> = {}): StepEvent => ({
  tick,
  type,
  at: { x: 1.5, y: 2 },
  ...more,
});

function filled() {
  const log = createEventLog();
  log.append(2, [ev(2, "sensor:enter", { entityId: "zone", other: "pad" })]);
  log.append(5, [ev(5, "dialogue:line", { data: { text: "hello" } })]);
  log.append(9, [ev(9, "sensor:exit", { entityId: "zone", other: "pad" })]);
  log.append(12, [ev(12, "audio:play", { entityId: "pad" })]);
  return log;
}

const rows = () =>
  within(screen.getByRole("list", { name: "Events" }))
    .getAllByRole("listitem")
    .map((li) => li.getAttribute("aria-label"));

afterEach(cleanup);

describe("EventLogPanel", () => {
  it("shows an empty state before anything happened", () => {
    render(<EventLogPanel events={createEventLog()} session={sessionOf()} notify={notify} />);
    expect(screen.getByText(/No events yet/)).toBeTruthy();
  });

  it("lists every event, with its tick, names and payload as plain data", () => {
    render(<EventLogPanel events={filled()} session={sessionOf()} notify={notify} />);
    expect(rows()).toEqual([
      "sensor:enter at tick 2",
      "dialogue:line at tick 5",
      "sensor:exit at tick 9",
      "audio:play at tick 12",
    ]);
    expect(screen.getAllByText(/zone → pad/)).toHaveLength(2);
    expect(screen.getByText(/\{"text":"hello"\}/)).toBeTruthy();
    expect(screen.getAllByText("1.5 m, 2 m")).toHaveLength(4);
  });

  it("filters by the types that occurred, by entity and by tick range", async () => {
    render(<EventLogPanel events={filled()} session={sessionOf()} notify={notify} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Event type" }));
    const options = await waitFor(() => screen.getAllByRole("option"));
    expect(options.map((o) => o.textContent)).toEqual([
      "All types",
      "audio:play",
      "dialogue:line",
      "sensor:enter",
      "sensor:exit",
    ]);
    const exit = screen.getByRole("option", { name: "sensor:exit" });
    fireEvent.mouseMove(exit);
    fireEvent.click(exit);
    await waitFor(() => expect(rows()).toEqual(["sensor:exit at tick 9"]));
  });

  it("filters by entity, as subject or other, and by tick range", () => {
    render(<EventLogPanel events={filled()} session={sessionOf()} notify={notify} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Entity" }), {
      target: { value: "pad" },
    });
    expect(rows()).toEqual([
      "sensor:enter at tick 2",
      "sensor:exit at tick 9",
      "audio:play at tick 12",
    ]);
    fireEvent.change(screen.getByRole("spinbutton", { name: "From tick" }), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByRole("spinbutton", { name: "To tick" }), {
      target: { value: "10" },
    });
    expect(rows()).toEqual(["sensor:exit at tick 9"]);
    fireEvent.change(screen.getByRole("textbox", { name: "Entity" }), {
      target: { value: "nobody" },
    });
    expect(screen.getByText("No events match the filters.")).toBeTruthy();
  });

  it("says when the tick range runs backwards, and reads a negative bound as 0", () => {
    render(<EventLogPanel events={filled()} session={sessionOf()} notify={notify} />);
    const from = screen.getByRole("spinbutton", { name: "From tick" });
    const to = screen.getByRole("spinbutton", { name: "To tick" });
    fireEvent.change(from, { target: { value: "10" } });
    fireEvent.change(to, { target: { value: "3" } });
    expect(screen.getByText(/From is after To/)).toBeTruthy();
    expect(from.getAttribute("aria-invalid")).toBe("true");
    expect(to.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(from, { target: { value: "-5" } });
    expect(from.hasAttribute("aria-invalid")).toBe(false);
    expect(rows()).toEqual(["sensor:enter at tick 2"]);
  });

  it("selects the entity an event names, and leaves rows with nothing to do as plain text", () => {
    const session = sessionOf();
    const log = filled();
    log.append(14, [ev(14, "spawn", { entityId: "bullet#3" })]);
    render(<EventLogPanel events={log} session={session} notify={notify} />);
    const row = screen.getByRole("listitem", { name: "sensor:enter at tick 2" });
    fireEvent.click(within(row).getByRole("button"));
    expect(session.store.state.selection).toEqual(["zone"]);
    for (const name of ["dialogue:line at tick 5", "spawn at tick 14"]) {
      const inert = screen.getByRole("listitem", { name });
      expect(within(inert).queryByRole("button")).toBeNull();
      expect(inert.hasAttribute("data-inert")).toBe(true);
    }
  });

  it("in Play, puts a spawned entity's event in the play inspector", async () => {
    const session = sessionOf();
    const log = createEventLog();
    log.append(7, [ev(7, "spawn", { entityId: "bullet#12" })]);
    const store = new Store({ mode: "play", tick: 0 } as unknown as GameStoreState);
    const inspect = vi.fn(
      async (id: string): Promise<EntityInspection | null> =>
        id === "bullet#12"
          ? {
              id,
              type: "bullet",
              enabled: true,
              pose: { x: 1, y: 2, rot: 0 },
              prevPose: null,
              entity: { id, type: "bullet" } as EntityInspection["entity"],
              system: undefined,
              behaviors: {},
              body: null,
              timers: [],
              contacts: ["pad"],
            }
          : null,
    );
    const game = {
      registry: session.registry,
      getStore: () => store,
      screenToWorld: (p: { x: number; y: number }) => p,
      router: { register: () => () => {} },
      debug: { ...fakeGameDebug(), inspect },
    } as unknown as PlayInspectorGame;
    render(
      <KitProvider host={{ storage: null }}>
        <EventLogPanel events={log} session={session} notify={notify} playing />
        <PlayInspector game={game} session={session} notify={notify} />
      </KitProvider>,
    );
    const row = screen.getByRole("listitem", { name: "spawn at tick 7" });
    fireEvent.click(within(row).getByRole("button"));
    const inspector = screen.getByLabelText("Play inspector");
    await waitFor(() => expect(within(inspector).getByText("bullet#12")).toBeTruthy());
    expect(session.store.state.selection).toEqual([]);

    const contacts = within(inspector).getByRole("list", { name: "Contacts" });
    fireEvent.click(within(contacts).getByRole("button", { name: "pad" }));
    await waitFor(() => expect(inspect).toHaveBeenLastCalledWith("pad"));
  });

  it("follows a running log and clears it", async () => {
    const log = createEventLog();
    render(<EventLogPanel events={log} session={sessionOf()} notify={notify} />);
    act(() => log.append(1, [ev(1, "coin", { entityId: "pad" })]));
    await waitFor(() => expect(rows()).toEqual(["coin at tick 1"]));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(screen.getByText(/No events yet/)).toBeTruthy());
  });

  it("shows a loaded run's events from one headless replay, beside Play's", async () => {
    const rapier = await loadCompatRapier();
    const registry = createRegistry(testGame);
    const yard = parseSceneOrThrow(engineYardJson, registry);
    const played = runPlaytest({
      rapier,
      game: testGame,
      registry,
      scene: yard,
      script: { v: 2, steps: [{ hold: ["right"], for: 180 }] },
    });
    if (played.blocked) throw new Error(JSON.stringify(played.issues));
    expect(played.events.length).toBeGreaterThan(0);
    const session = createEditorSession({
      doc: sceneToDoc(yard, { key: sequentialKeys("y") }),
      origin: ada,
      name: yard.name,
      registry,
      issuesDebounceMs: 0,
    });
    const run = new Store<LoadedRun | null>(null);
    const replayHost = { rapier, game: testGame, registry };
    const live = createEventLog();
    render(
      <EventLogPanel
        events={live}
        session={session}
        notify={notify}
        run={run}
        replayHost={replayHost}
      />,
    );
    expect(screen.getByText(/No events yet/)).toBeTruthy();
    act(() => run.setState(() => ({ recording: played.recording, name: "run.json" })));
    await waitFor(() =>
      expect(rows()).toEqual(played.events.map((e) => `${e.type} at tick ${e.tick}`)),
    );

    act(() => live.append(0, [ev(0, "coin", { entityId: "zone" })]));
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    await waitFor(() => expect(rows()).toEqual(["coin at tick 0"]));
    fireEvent.click(screen.getByRole("button", { name: "run.json" }));
    await waitFor(() => expect(rows()).toHaveLength(played.events.length));
  });
});

describe("loadedRunEvents", () => {
  const yard = (): SceneDefinition => ({ v: 1, name: "y", bounds: [0, 0, 10, 10], entities: [] });
  const run = { recording: {} as LoadedRun["recording"], name: "r" };

  it("keeps a log per recording, scene and host, and never keeps a blocked replay", () => {
    let blocked = true;
    const replayed = vi.fn((opts: Parameters<typeof replayRecording>[0]) => {
      opts.onEvents?.(1, [ev(1, "coin")]);
      return { blocked } as ReturnType<typeof replayRecording>;
    });
    const replay = replayed as unknown as typeof replayRecording;
    const scene = yard();
    const registry = createRegistry();
    expect(loadedRunEvents(run, { scene, registry, rapier: null }, replay)).toBeNull();
    blocked = false;
    const host = { scene, registry, rapier: null };
    const log = loadedRunEvents(run, host, replay);
    expect(log?.list().map((e) => e.type)).toEqual(["coin"]);
    expect(loadedRunEvents(run, { ...host }, replay)).toBe(log);
    expect(replayed).toHaveBeenCalledTimes(2);
    expect(loadedRunEvents(run, { ...host, registry: createRegistry() }, replay)).not.toBe(log);
    expect(loadedRunEvents(run, { ...host, scene: yard() }, replay)).not.toBe(log);
    expect(replayed).toHaveBeenCalledTimes(4);
  });
});
