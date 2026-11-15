// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { TICK_PHASES, type RuntimeTimings } from "../../runtime/timings";
import { createGameStore, setTimings } from "../../store";
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
  const game = { getStore: () => store } as unknown as PerfReadoutGame;
  return { store, game };
}

describe("PerfReadout", () => {
  it("says nothing is measured yet without timings, or without a game", () => {
    const { container } = render(<PerfReadout game={gameWith(null).game} />);
    expect(container.textContent).toContain("Nothing yet");
    cleanup();
    render(<PerfReadout game={null} />);
    expect(screen.getByText(/Nothing yet/)).toBeTruthy();
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

    act(() => setTimings(store, null));
    expect(container.textContent).toContain("Nothing yet");
  });
});
