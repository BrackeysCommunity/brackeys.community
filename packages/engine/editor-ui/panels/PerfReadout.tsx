import { useEffect, useMemo } from "react";

import { perfPlan, type PerfRow } from "../../debug/perf";
import { formatMs } from "../../runtime/timings";
import type { GameInstance, GameStoreState } from "../../types";
import { MicroLabel, Progress, Text } from "../kit/index";
import { useStoreValue, type ReadableStore } from "../session/use-store-value";

/** The parts of the game the perf readout reads: the store's `timings`, held on while it shows. */
export type PerfReadoutGame = Pick<GameInstance, "getStore" | "debug">;

const ms = (v: number) => `${formatMs(v)} ms`;

/** Never a store: a stand-in so the hook runs the same way without a game. */
const NO_STORE: ReadableStore<Pick<GameStoreState, "timings">> = {
  state: { timings: null },
  subscribe: () => () => {},
};

/** The runtime's per-phase timings and the shell's frame time, kept on while the readout is open. */
export function PerfReadout(props: { game: PerfReadoutGame | null }) {
  const { game } = props;
  useEffect(() => {
    if (!game) return;
    game.debug.wantTimings(true);
    return () => game.debug.wantTimings(false);
  }, [game]);
  const store: ReadableStore<Pick<GameStoreState, "timings">> = game?.getStore() ?? NO_STORE;
  const timings = useStoreValue(store, (s) => s.timings, Object.is);
  const plan = useMemo(() => (timings ? perfPlan(timings) : null), [timings]);

  if (!plan) {
    return (
      <Text as="p" size="xs" variant="muted" className="je-panel-empty">
        Nothing yet. Timings show here a couple of seconds into Play.
      </Text>
    );
  }

  const { frame } = plan;
  return (
    <section className="je-insp-stack" aria-label="Perf">
      <Text as="p" size="xs" variant="muted">
        Mean per tick over the last {plan.ticks} ticks; the bar is the mean against the slowest
        phase's worst tick.
      </Text>
      {plan.bars.map((bar) => (
        <div key={bar.phase} className="je-insp-stack" data-gap="tight" data-phase={bar.phase}>
          <Progress
            value={bar.meanFrac * 100}
            label={
              <MicroLabel>
                {bar.phase} · {ms(bar.mean)} · worst {ms(bar.max)}
              </MicroLabel>
            }
          />
        </div>
      ))}
      {frame ? (
        <div className="je-insp-stack" data-gap="tight" aria-label="Frame" role="group">
          <MicroLabel>Frame</MicroLabel>
          {(["render", "present"] as const).map((part) => (
            <div key={part} className="je-insp-row" data-name={part}>
              <Text size="xs">{part === "render" ? "Render" : "Present"}</Text>
              <Text size="xs" variant="muted" tabular>
                {ms(frame[part].mean)} · worst {ms(frame[part].max)}
              </Text>
            </div>
          ))}
        </div>
      ) : null}
      <Slowest title="Slowest systems" rows={plan.systems} />
      <Slowest title="Slowest behaviors" rows={plan.behaviors} />
    </section>
  );
}

function Slowest({ title, rows }: { title: string; rows: readonly PerfRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="je-insp-stack" data-gap="tight" aria-label={title} role="group">
      <MicroLabel>{title}</MicroLabel>
      {rows.map((row) => (
        <div key={row.name} className="je-insp-row" data-name={row.name}>
          <Text size="xs" ellipsis>
            {row.name}
          </Text>
          <Text size="xs" variant="muted" tabular>
            {ms(row.mean)} · worst {ms(row.max)}
          </Text>
        </div>
      ))}
    </div>
  );
}
