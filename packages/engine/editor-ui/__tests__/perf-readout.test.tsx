// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { TICK_PHASES, type RuntimeTimings } from "../../runtime/timings";
import { createGameStore, setMode, setTimings } from "../../store";
import { PerfReadout, type PerfReadoutGame } from "../panels/PerfReadout";

afterEach(cleanup);

const FIXTURE: RuntimeTimings = {
  ticks: 120,
  phases: Object.fromEntries(
    TICK_PHASES.map((p) => [p, p === "physics" ? { mean: 1.5, max: 3 } : { mean: 0.1, max: 0.2 }]),
  ) as RuntimeTimings["phases"],
  systems: { sensor: { mean: 0.2, max: 0.4 } },
  behaviors: { script: { mean: 0.3, max: 0.9 } },
};

function gameWith(timings: RuntimeTimings | null) {
  const store = createGameStore();
  setTimings(store, timings);
  const wantTimings = vi.fn();
  const game = { getStore: () => store, debug: { wantTimings } } as unknown as PerfReadoutGame;
  return { store, game, wantTimings };
}

describe("PerfReadout", () => {
  it("shows the Play views' pending line in Play until timings arrive", () => {
    const { container } = render(<PerfReadout game={gameWith(null).game} />);
    const pending = screen.getByRole("status");
    expect(pending.querySelector(".je-spinner")).not.toBeNull();
    expect(pending.textContent).toContain("Gathering timings");
    expect(container.textContent).not.toContain("No timings yet");
  });

  it("shows the empty line outside Play, or without a game", () => {
    const { store, game } = gameWith(null);
    setMode(store, "edit");
    render(<PerfReadout game={game} />);
    expect(screen.getByText(/No timings yet/)).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    cleanup();
    render(<PerfReadout game={null} />);
    expect(screen.getByText(/No timings yet/)).toBeTruthy();
  });

  it("shows every phase, the slowest systems and behaviors, and follows the store", () => {
    const { store, game } = gameWith(null);
    const { container } = render(<PerfReadout game={game} />);
    act(() => setTimings(store, FIXTURE));

    const phases = [...container.querySelectorAll("[data-phase]")].map((el) =>
      el.getAttribute("data-phase"),
    );
    expect(phases).toEqual([...TICK_PHASES]);
    expect(container.textContent).toContain("physics · 1.500 ms · worst 3.000 ms");
    expect(container.textContent).toContain("last 120 ticks");
    expect(screen.getByRole("group", { name: "Slowest systems" }).textContent).toContain("sensor");
    expect(screen.getByRole("group", { name: "Slowest behaviors" }).textContent).toContain(
      "0.300 ms · worst 0.900 ms",
    );
    expect(container.querySelector("[title]")).toBeNull();
    expect(screen.queryByRole("group", { name: "Frame" })).toBeNull();

    act(() =>
      setTimings(store, {
        ...FIXTURE,
        frame: { render: { mean: 0.8, max: 2 }, present: { mean: 1.25, max: 4 } },
      }),
    );
    const frame = screen.getByRole("group", { name: "Frame" }).textContent;
    expect(frame).toContain("Render0.800 ms · worst 2.000 ms");
    expect(frame).toContain("Present1.250 ms · worst 4.000 ms");

    act(() => setTimings(store, null));
    expect(container.textContent).toContain("Gathering timings");
  });

  it("holds the game's timings on while it is open", () => {
    const { game, wantTimings } = gameWith(null);
    const { unmount } = render(<PerfReadout game={game} />);
    expect(wantTimings.mock.calls).toEqual([[true]]);
    unmount();
    expect(wantTimings.mock.calls).toEqual([[true], [false]]);
  });
});
