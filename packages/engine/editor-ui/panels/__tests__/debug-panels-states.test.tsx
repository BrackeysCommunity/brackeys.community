// @vitest-environment jsdom
import { Store } from "@tanstack/store";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../../collab/index";
import { createEventLog } from "../../../debug/event-log";
import type { EntityRow } from "../../../debug/inspect";
import { createEditorSession } from "../../../editor/index";
import { createRegistry } from "../../../game/index";
import { TICK_PHASES, type RuntimeTimings } from "../../../runtime/timings";
import type { StepEvent } from "../../../runtime/types";
import type { GameStoreState } from "../../../types";
import { fakeGameDebug } from "../../__tests__/fake-world-game";
import type { EditorNotify } from "../../host";
import { KitProvider } from "../../kit/index";
import { EVENT_LOG_ROWS, EventLogPanel } from "../EventLogPanel";
import { PerfReadout, type PerfReadoutGame } from "../PerfReadout";
import { SpawnedGroup, type SpawnedGroupGame } from "../SpawnedGroup";

const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const notify: EditorNotify = Object.assign(vi.fn(), {
  error: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
});

const sessionOf = () =>
  createEditorSession({
    doc: sceneToDoc(
      { v: 1, name: "yard", bounds: [0, 0, 2000, 1200], entities: [] },
      { key: sequentialKeys("t") },
    ),
    origin: ada,
    name: "yard",
    registry: createRegistry(),
    issuesDebounceMs: 0,
  });

const storeOf = (over: Partial<GameStoreState> = {}) =>
  new Store({ mode: "play", tick: 0, timings: null, ...over } as unknown as GameStoreState);

afterEach(cleanup);

describe("the Spawned group's read states", () => {
  const mount = (entities: () => Promise<EntityRow[]>) => {
    const store = storeOf();
    const game = { getStore: () => store, debug: { ...fakeGameDebug(), entities } };
    render(
      <KitProvider host={{ storage: null }}>
        <SpawnedGroup game={game as SpawnedGroupGame} session={sessionOf()} />
      </KitProvider>,
    );
    return screen.getByRole("region", { name: "Spawned" });
  };

  it("shows the kit spinner while the first read is on the way, then the empty state", async () => {
    let answer: (rows: EntityRow[]) => void = () => {};
    const region = mount(() => new Promise((resolve) => (answer = resolve)));
    const pending = within(region).getByRole("status");
    expect(pending.querySelector(".je-spinner")).not.toBeNull();
    expect(pending.textContent).toContain("Reading");
    expect(within(region).queryByText("Nothing spawned yet")).toBeNull();

    await act(async () => answer([]));
    expect(within(region).getByText("Nothing spawned yet")).toBeTruthy();
    expect(region.querySelector(".je-spinner")).toBeNull();
  });

  it("says why when the read fails, rather than reading forever", async () => {
    const region = mount(async () => {
      throw new Error("the world is gone");
    });
    await waitFor(() => expect(region.textContent).toContain("the world is gone"));
    expect(region.querySelector(".je-spinner")).toBeNull();
  });
});

describe("the event log's rows", () => {
  const ev = (tick: number): StepEvent => ({ tick, type: "coin", at: { x: 0, y: 0 } });

  it("keep their nodes while older events slide out of the newest window", async () => {
    const log = createEventLog();
    for (let t = 0; t < EVENT_LOG_ROWS; t++) log.append(t, [ev(t)]);
    render(<EventLogPanel events={log} session={sessionOf()} notify={notify} />);
    // A role query computes every row's accessible name; over the full window
    // that is seconds per call in jsdom, so rows are found by their label.
    const list = screen.getByRole("list", { name: "Events" });
    const rowAt = (tick: number) => within(list).queryByLabelText(`coin at tick ${tick}`);
    const before = rowAt(EVENT_LOG_ROWS - 1);
    expect(before?.tagName).toBe("LI");
    expect(list.children).toHaveLength(EVENT_LOG_ROWS);

    act(() => log.append(EVENT_LOG_ROWS, [ev(EVENT_LOG_ROWS)]));
    await waitFor(() => expect(rowAt(EVENT_LOG_ROWS)).not.toBeNull());
    expect(rowAt(0)).toBeNull();
    expect(rowAt(EVENT_LOG_ROWS - 1)).toBe(before);
    expect(list.children).toHaveLength(EVENT_LOG_ROWS);
  });

  it("ask before Clear, saying it can't be undone", async () => {
    const log = createEventLog();
    log.append(1, [ev(1)]);
    render(
      <KitProvider host={{ storage: null }}>
        <EventLogPanel events={log} session={sessionOf()} notify={notify} />
      </KitProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("can't be undone");
    expect(log.list()).toHaveLength(1);
  });

  it("share Problems' list-row classes rather than borrowing its own", () => {
    const log = createEventLog();
    log.append(1, [ev(1)]);
    render(<EventLogPanel events={log} session={sessionOf()} notify={notify} />);
    const panel = screen.getByRole("region", { name: "Event log" });
    expect(panel.classList.contains("je-list")).toBe(true);
    expect(panel.querySelector("[class*='je-problems']")).toBeNull();
    expect(within(panel).getByRole("listitem").className).toBe("je-list-row");
  });
});

describe("the perf readout", () => {
  it("explains the bars in plain words", () => {
    const stat = { mean: 0.5, max: 1 };
    const timings = {
      ticks: 120,
      phases: Object.fromEntries(TICK_PHASES.map((p) => [p, stat])),
      systems: {},
      behaviors: {},
    } as unknown as RuntimeTimings;
    const store = storeOf({ timings });
    const game = {
      getStore: () => store,
      debug: { ...fakeGameDebug(), wantTimings: vi.fn() },
    };
    render(<PerfReadout game={game as unknown as PerfReadoutGame} />);
    expect(
      screen.getByText(
        "Average time per tick over the last 120 ticks. A full bar is the slowest tick any phase took.",
      ),
    ).toBeTruthy();
  });
});
