// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { CalendarGrid } from "@/components/profile/ContributionCalendar";
import type { ContributionDay } from "@/lib/contributions";
import { AppSettingsProvider } from "@/lib/hooks/use-app-settings";

const confetti = vi.fn();
vi.mock("party-js", () => ({
  default: { confetti: (...args: unknown[]) => confetti(...args), variation: { range: () => 1 } },
}));

// The snake starts at column 0, row 3, already heading right, and one tick
// carries it to column 1. Putting the board's only contribution there means
// a single tick clears it — the whole win condition in one frame.
const TICK_MS = 110;
const FOOD_COL = 1;
const FOOD_ROW = 3;

function day(count: number): ContributionDay {
  return { date: "2026-01-01", contributionCount: count, bySource: {} };
}

function board(foodCells: Array<[col: number, row: number]>) {
  return Array.from({ length: 3 }, (_, col) => ({
    contributionDays: Array.from({ length: 7 }, (_, row) =>
      day(foodCells.some(([c, r]) => c === col && r === row) ? 1 : 0),
    ),
  }));
}

function renderBoard(weeks: ReturnType<typeof board>) {
  return render(
    <AppSettingsProvider>
      <CalendarGrid
        weeks={weeks}
        totalContributions={weeks.length}
        maxCount={1}
        sources={[{ key: "github", label: "GITHUB" }]}
        monthHeaders={[]}
        playing
        onToggleSnake={() => {}}
      />
    </AppSettingsProvider>,
  );
}

/** Start the game and run `ticks` frames of the loop. */
async function play(ticks: number) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
  });
  for (let i = 0; i < ticks; i++) {
    await act(async () => {
      vi.advanceTimersByTime(TICK_MS);
    });
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  confetti.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("clearing the contribution board", () => {
  it("declares a win once the last contribution is eaten", async () => {
    renderBoard(board([[FOOD_COL, FOOD_ROW]]));

    expect(screen.queryByText(/board cleared/i)).toBeNull();
    await play(1);

    expect(screen.getByText(/board cleared/i)).toBeTruthy();
    expect(screen.queryByText(/game over/i)).toBeNull();
  });

  it("keeps playing while contributions remain", async () => {
    renderBoard(
      board([
        [FOOD_COL, FOOD_ROW],
        [FOOD_COL + 1, FOOD_ROW],
      ]),
    );

    await play(1);

    expect(screen.queryByText(/board cleared/i)).toBeNull();
  });

  // The regression this guards: a profile with nothing to eat starts with an
  // empty board, so a win keyed purely on "no food left" would fire before
  // the player had moved.
  it("does not hand a win to a profile with no contributions", async () => {
    renderBoard(board([]));

    await play(3);

    expect(screen.queryByText(/board cleared/i)).toBeNull();
    expect(confetti).not.toHaveBeenCalled();
  });
});
