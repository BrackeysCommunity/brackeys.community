// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Store } from "@tanstack/store";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { testGame } from "../../__tests__/fixtures/test-game";
import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../collab/index";
import { createEventLog } from "../../debug/event-log";
import { createEditorSession } from "../../editor/index";
import { createRegistry } from "../../game/index";
import { runPlaytest, type RapierModule } from "../../headless/index";
import type { ReplayHandle } from "../../index";
import { parseSceneOrThrow } from "../../scene/index";
import type { EditorNotify } from "../host";
import { EventLogPanel } from "../panels/EventLogPanel";
import { LoadRunPanel, SCRUB_DEBOUNCE_MS, type ReplaySource } from "../panels/LoadRunPanel";
import { createLoadedRunStore, parseRun, type LoadedRun } from "../session/loaded-run";

const notify: EditorNotify = Object.assign(vi.fn(), {
  error: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
});
const registry = createRegistry(testGame);
const yard = parseSceneOrThrow(
  readFileSync(resolve("packages/engine/scenes/engine-yard.json"), "utf8"),
  registry,
);
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };

let run: LoadedRun;

beforeAll(async () => {
  const rapier: RapierModule = await import("@dimforge/rapier2d");
  const report = runPlaytest({
    rapier,
    game: testGame,
    registry,
    scene: yard,
    script: { v: 1, scene: "engine-yard", steps: [{ hold: ["right"], for: 90 }] },
  });
  if (report.blocked) throw new Error(`blocked at ${report.stage}`);
  const parsed = parseRun(JSON.stringify(report.recording), "run.json");
  if (!parsed.ok) throw new Error(parsed.error);
  run = parsed.run;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const session = () =>
  createEditorSession({
    doc: sceneToDoc(yard, { key: sequentialKeys("t") }),
    origin: ada,
    name: yard.name,
    registry,
    issuesDebounceMs: 0,
  });

/** A replay whose seeks wait until `finish` is called, as a long re-simulation does. */
function fakeReplay(ticks: number) {
  const store = new Store({ tick: 0 });
  const seeks: number[] = [];
  const waiting: (() => void)[] = [];
  const checkpoints = [0];
  const handle: ReplayHandle = {
    get tick() {
      return store.state.tick;
    },
    ticks,
    seek: vi.fn((tick: number) => {
      seeks.push(tick);
      return new Promise<void>((done) => {
        waiting.push(() => {
          store.setState(() => ({ tick }));
          done();
        });
      });
    }),
    play: vi.fn(),
    pause: vi.fn(),
    step: vi.fn(),
    checkpoints,
  };
  const source: ReplaySource = { replayHandle: () => handle, getStore: () => store };
  const finish = async () => {
    await act(async () => {
      for (const w of waiting.splice(0)) w();
    });
  };
  return { source, seeks, finish, checkpoints };
}

function mountRun(source: ReplaySource) {
  const store = createLoadedRunStore();
  store.setState(() => run);
  render(
    <LoadRunPanel
      session={session()}
      run={store}
      onPlayFrom={() => {}}
      onReplay={() => {}}
      replay={source}
      notify={notify}
    />,
  );
}

const RANGE = 'input[type="range"][aria-label="Replay tick"]';
const scrubber = () => {
  const el = document.querySelector(RANGE);
  if (!el) throw new Error("no scrubber");
  return el;
};

describe("the replay scrubber", () => {
  it("shows no scrubber outside a replay", () => {
    mountRun({ replayHandle: () => null, getStore: () => new Store({ tick: 0 }) });
    expect(document.querySelector(RANGE)).toBeNull();
  });

  it("seeks once per debounce while the range is dragged", () => {
    vi.useFakeTimers();
    const fake = fakeReplay(90);
    mountRun(fake.source);
    const slider = scrubber();
    for (let i = 0; i < 5; i++) fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(fake.seeks).toEqual([]);
    act(() => vi.advanceTimersByTime(SCRUB_DEBOUNCE_MS - 1));
    expect(fake.seeks).toEqual([]);
    act(() => vi.advanceTimersByTime(1));
    expect(fake.seeks).toEqual([5]);
    fireEvent.keyDown(slider, { key: "End" });
    act(() => vi.advanceTimersByTime(SCRUB_DEBOUNCE_MS));
    expect(fake.seeks).toEqual([5, 90]);
  });

  it("shows where a slow seek goes, and a newer drag supersedes it", async () => {
    vi.useFakeTimers();
    const fake = fakeReplay(900);
    mountRun(fake.source);
    const slider = scrubber();
    fireEvent.keyDown(slider, { key: "End" });
    act(() => vi.advanceTimersByTime(SCRUB_DEBOUNCE_MS));
    const status = screen.getByRole("status");
    expect(within(status).getByText("Re-simulating to tick 900")).toBeTruthy();
    expect(within(status).getByRole("progressbar")).toBeTruthy();
    fireEvent.keyDown(slider, { key: "Home" });
    act(() => vi.advanceTimersByTime(SCRUB_DEBOUNCE_MS));
    expect(screen.getByText("Re-simulating to tick 0")).toBeTruthy();
    expect(fake.seeks).toEqual([900, 0]);
    await fake.finish();
    expect(screen.queryByText(/Re-simulating/)).toBeNull();
  });
});

describe("the event log while a replay runs", () => {
  it("seeks to an event's tick, where it otherwise selects", () => {
    const log = createEventLog();
    log.append(42, [{ tick: 42, type: "sensor:enter", at: { x: 0, y: 0 }, entityId: "zone" }]);
    log.append(50, [{ tick: 50, type: "dialogue:line", at: { x: 0, y: 0 } }]);
    const fake = fakeReplay(90);
    const s = session();
    render(<EventLogPanel events={log} session={s} notify={notify} replay={fake.source} />);
    fireEvent.click(
      within(screen.getByRole("listitem", { name: "sensor:enter at tick 42" })).getByRole("button"),
    );
    expect(fake.seeks).toEqual([42]);
    expect(s.store.state.selection).toEqual([]);
    const line = within(screen.getByRole("listitem", { name: "dialogue:line at tick 50" }));
    fireEvent.click(line.getByRole("button"));
    expect(fake.seeks).toEqual([42, 50]);
  });
});
