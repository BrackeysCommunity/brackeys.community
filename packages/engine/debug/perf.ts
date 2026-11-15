import { Container, Graphics, Text, TextStyle } from "pixi.js";

import {
  formatMs,
  TICK_PHASES,
  type RuntimeTimings,
  type TickPhase,
  type TimingStat,
} from "../runtime/timings";
import type { DebugLayerFactory } from "./index";

/** Systems and behaviors listed, slowest first. */
export const PERF_SLOWEST = 5;

// Canvas px; ORIGIN.y clears the editor's floating Play toolbar.
const ORIGIN = { x: 8, y: 60 } as const;
const BAR_HEIGHT = 8;
const ROW = 12;
const LABEL_WIDTH = 92;
const BAR_WIDTH = 140;
const PANEL_PAD = 6;

const PANEL_COLOR = 0x000000;
const PANEL_ALPHA = 0.6;
const MEAN_COLOR = 0x66ccff;
const MAX_COLOR = 0x335566;

let textStyle: TextStyle | null = null;
const textStyleOf = () =>
  (textStyle ??= new TextStyle({ fontFamily: "monospace", fontSize: 10, fill: 0xdddddd }));

export type PerfBar = {
  phase: TickPhase;
  mean: number;
  max: number;
  /** `mean` and `max` as 0..1 of the plan's scale. */
  meanFrac: number;
  maxFrac: number;
};
export type PerfRow = { name: string; mean: number; max: number };

/** What the perf layer draws for one `RuntimeTimings`. */
export type PerfPlan = {
  ticks: number;
  /** The widest bar's ms: the slowest phase's max. */
  scaleMs: number;
  bars: PerfBar[];
  systems: PerfRow[];
  behaviors: PerfRow[];
  /** The shell's render and present ms per frame; null when the timings carry none. */
  frame: { render: TimingStat; present: TimingStat } | null;
};

function slowest(from: Readonly<Record<string, TimingStat>>): PerfRow[] {
  return Object.entries(from)
    .map(([name, s]) => ({ name, mean: s.mean, max: s.max }))
    .sort((a, b) => b.mean - a.mean || b.max - a.max || (a.name < b.name ? -1 : 1))
    .slice(0, PERF_SLOWEST);
}

/** The phases as bars scaled to the slowest phase's max, and the five slowest systems and behaviors by mean. */
export function perfPlan(timings: RuntimeTimings): PerfPlan {
  let scaleMs = 0;
  for (const phase of TICK_PHASES) scaleMs = Math.max(scaleMs, timings.phases[phase].max);
  const frac = (v: number) => (scaleMs > 0 ? Math.min(1, v / scaleMs) : 0);
  return {
    ticks: timings.ticks,
    scaleMs,
    bars: TICK_PHASES.map((phase) => {
      const { mean, max } = timings.phases[phase];
      return { phase, mean, max, meanFrac: frac(mean), maxFrac: frac(max) };
    }),
    systems: slowest(timings.systems),
    behaviors: slowest(timings.behaviors),
    frame: timings.frame ?? null,
  };
}

const fmt = (s: TimingStat) => `${formatMs(s.mean)} / ${formatMs(s.max)}`;

/** The plan's text lines, top to bottom; the bar rows line up with the first `TICK_PHASES.length` after the header. */
export function perfLines(plan: PerfPlan): string[] {
  const lines = [`tick ms over ${plan.ticks} ticks (mean / max)`];
  for (const bar of plan.bars) lines.push(`${bar.phase} ${fmt(bar)}`);
  if (plan.frame) {
    lines.push("frame ms (mean / max)");
    lines.push(`  render ${fmt(plan.frame.render)}`, `  present ${fmt(plan.frame.present)}`);
  }
  for (const [title, rows] of [
    ["slowest systems", plan.systems],
    ["slowest behaviors", plan.behaviors],
  ] as const) {
    if (rows.length === 0) continue;
    lines.push(title);
    for (const row of rows) lines.push(`  ${row.name} ${fmt(row)}`);
  }
  return lines;
}

/** The runtime's phases as bars, the shell's frame time, and the five slowest systems and behaviors, from `GameStoreState.timings`. */
export const perfLayer: DebugLayerFactory = {
  id: "perf",
  needs: { timings: true },
  create(host) {
    const root = new Container({ label: "debug-perf" });
    const panel = new Graphics();
    const bars = new Graphics();
    const labels = new Container();
    root.addChild(panel, bars, labels);
    root.position.set(ORIGIN.x, ORIGIN.y);
    root.visible = false;
    host.uiContainer.addChild(root);
    let drawn: RuntimeTimings | null | undefined;

    function clearLabels(): void {
      for (const child of labels.removeChildren()) child.destroy();
    }

    function draw(timings: RuntimeTimings | null): void {
      panel.clear();
      bars.clear();
      clearLabels();
      if (!timings) {
        labels.addChild(
          new Text({ text: "perf: waiting for a full window", style: textStyleOf() }),
        );
        return;
      }
      const plan = perfPlan(timings);
      const lines = perfLines(plan);
      lines.forEach((line, i) => {
        const bar = i >= 1 ? plan.bars[i - 1] : undefined;
        const y = i * ROW;
        if (!bar) {
          const text = new Text({ text: line, style: textStyleOf() });
          text.position.set(0, y);
          labels.addChild(text);
          return;
        }
        const name = new Text({ text: bar.phase, style: textStyleOf() });
        name.position.set(0, y);
        const value = new Text({ text: fmt(bar), style: textStyleOf() });
        value.position.set(LABEL_WIDTH + BAR_WIDTH + PANEL_PAD, y);
        labels.addChild(name, value);
        const top = y + (ROW - BAR_HEIGHT) / 2;
        if (bar.maxFrac > 0)
          bars.rect(LABEL_WIDTH, top, BAR_WIDTH * bar.maxFrac, BAR_HEIGHT).fill(MAX_COLOR);
        if (bar.meanFrac > 0)
          bars.rect(LABEL_WIDTH, top, BAR_WIDTH * bar.meanFrac, BAR_HEIGHT).fill(MEAN_COLOR);
      });
      panel
        .rect(
          -PANEL_PAD,
          -PANEL_PAD,
          LABEL_WIDTH + BAR_WIDTH * 2 + PANEL_PAD * 2,
          lines.length * ROW + PANEL_PAD * 2,
        )
        .fill({ color: PANEL_COLOR, alpha: PANEL_ALPHA });
    }

    return {
      update(frame) {
        const timings = frame.timings ?? null;
        if (timings === drawn) return;
        drawn = timings;
        draw(timings);
      },
      setVisible(visible) {
        root.visible = visible;
      },
      destroy() {
        clearLabels();
        root.destroy({ children: true });
      },
    };
  },
};
