import { createRunTiming, type RunTiming, type TimingReport } from "@jams/engine/headless";

/** The collector a `--timing` run steps under, on the process's wall clock. */
export const wallTiming = (): RunTiming => createRunTiming(() => performance.now());

/**
 * Who a part of the tick belongs to: `physics` is the Rapier world step,
 * `game` the game module's hooks, `engine` everything else the runtime runs
 * (type systems, behaviors, contacts, timers, events, lifecycle).
 */
export type TimingGroup = "physics" | "engine" | "game";

export const timingGroup = (part: string): TimingGroup =>
  part.startsWith("physics.") ? "physics" : part.startsWith("game.") ? "game" : "engine";

export type TimingGroups = Record<TimingGroup | "unattributed", number>;

/** The tick's total split by `timingGroup`, in ms. */
export function timingGroups(timing: TimingReport): TimingGroups {
  const groups: TimingGroups = {
    physics: 0,
    engine: 0,
    game: 0,
    unattributed: timing.tick.unattributedMs,
  };
  for (const [part, bucket] of Object.entries(timing.tick.parts))
    groups[timingGroup(part)] += bucket.totalMs;
  return groups;
}

const fixed = (value: number, digits: number, width: number) =>
  value.toFixed(digits).padStart(width);

/**
 * The `--timing` block: the tick's total, mean and worst, each part by
 * total (its share of the tick, mean per tick, worst tick, calls), what no
 * part covers, and the split by group.
 */
export function timingLines(timing: TimingReport): string[] {
  const { tick } = timing;
  if (tick.calls === 0) return ["  timing: no ticks ran"];
  const share = (ms: number) => (tick.totalMs > 0 ? (ms / tick.totalMs) * 100 : 0);
  const parts = Object.entries(tick.parts).sort(([, a], [, b]) => b.totalMs - a.totalMs);
  const width = Math.max("unattributed".length, ...parts.map(([name]) => name.length));
  const row = (name: string, totalMs: number, rest = "") =>
    `    ${name.padEnd(width)} ${fixed(totalMs, 1, 9)} ms ${fixed(share(totalMs), 1, 5)}%${rest}`;
  const groups = timingGroups(timing);
  return [
    `  timing (wall clock): ${tick.calls} ticks in ${tick.totalMs.toFixed(1)} ms, mean ${(tick.totalMs / tick.calls).toFixed(3)} ms, worst ${tick.maxMs.toFixed(3)} ms`,
    ...parts.map(([name, part]) =>
      row(
        name,
        part.totalMs,
        `  mean ${fixed(part.totalMs / tick.calls, 3, 7)}  worst ${fixed(part.maxMs, 3, 7)}  ×${part.calls}`,
      ),
    ),
    row("unattributed", tick.unattributedMs),
    `    by group: ${(["physics", "engine", "game", "unattributed"] as const)
      .map((group) => `${group} ${share(groups[group]).toFixed(1)}%`)
      .join(", ")}`,
  ];
}
