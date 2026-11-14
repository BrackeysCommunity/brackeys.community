import { z } from "zod";

import type { ENGINE_COMMANDS } from "../../game/commands";
import { defineGame } from "../../game/define";
import type { EngineContext, GameCommand } from "../../game/types";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/types";
import type { GenreProbe } from "./harness";

const ID = "idle";
const COLLECT = "collect";
export const BUY = "buy";
const GENERATOR = "generator";
const ELAPSED = "@elapsed" satisfies keyof typeof ENGINE_COMMANDS;

/** Coins one collect press gives. */
const COLLECT_VALUE = 1;
/** Coins earned in all that win the run. */
export const TARGET = 100_000;
/** The longest time away one `@elapsed` credits: an hour. */
export const CATCH_UP_MAX_MS = 3_600_000;

type GeneratorRow = { id: string; cost: number; step: number; perSecond: number };

/** The probe project's generator table: each one's first price, its rise per purchase, and its income. */
export const GENERATOR_ROWS: readonly GeneratorRow[] = [
  { id: "crank", cost: 10, step: 5, perSecond: 1 },
  { id: "mill", cost: 100, step: 50, perSecond: 10 },
  { id: "foundry", cost: 2_000, step: 1_000, perSecond: 120 },
];

export type IdleSnapshot = {
  coins: number;
  /** Coins earned in all, spending aside: the target reads this. */
  earned: number;
  /** Income left over below one coin, in 1 / (rate × 1000) of a coin. */
  carry: number;
  collects: number;
  /** Time away credited through `@elapsed`, after the catch-up clamp. */
  awayMs: number;
  /** In table order: how many are owned and what the next one costs. */
  generators: { id: string; owned: number; price: number }[];
};

/** What the shell's store holds for a HUD: plain data, a new object only when it changes. */
export type IdleSlice = { coins: number; perSecond: number; owned: number };

/** The command that buys one more of a generator, if the coins cover its price. */
export const buy = (generator: string): GameCommand => ({ name: BUY, args: { generator } });

/**
 * A clicker with no physics on the event clock. A collect press gives a
 * coin; `buy` spends coins on a generator from the project's `generator`
 * table (`ctx.project.table`), each purchase raising the next price. While
 * anything is owned the game stays busy, so the clock keeps stepping and
 * income accrues per tick; time away arrives as one `@elapsed`, clamped to
 * an hour, and credits the same income for that span. Income is kept in
 * whole fractions of a coin, so a long absence and many ticks sum exactly.
 * The run is won once the coins earned reach the target.
 */
const game = defineGame<IdleSnapshot>({
  id: ID,
  types: [],
  time: { kind: "event", catchUp: { maxMs: CATCH_UP_MAX_MS } },
  world: { physics: "none" },
  actions: [{ action: COLLECT, keys: [" "], description: "Collect a coin." }],
  tables: {
    [GENERATOR]: {
      description: "What coins buy, in the order the shop lists them.",
      row: {
        cost: z.number().int().positive().describe("The first one's price in coins."),
        step: z.number().int().nonnegative().describe("How much each purchase raises the price."),
        perSecond: z.number().int().positive().describe("Coins each one earns per second."),
      },
    },
  },
  commands: {
    [BUY]: {
      description: "Buy one more of a generator, if the coins cover its price.",
      args: z.strictObject({
        generator: z.string().min(1).describe("The generator's id in the table."),
      }),
    },
  },
  play: {
    results: ["won"],
    outcome: ({ snapshot: s }) =>
      s.earned >= TARGET ? { result: "won", cause: `${s.earned} coins earned` } : null,
    commands: ({ snapshot: s }) =>
      s.generators.filter((g) => g.price <= s.coins).map((g) => buy(g.id)),
  },
  createRuntime(ctx: EngineContext) {
    let rows: readonly GeneratorRow[] = [];
    let owned: number[] = [];
    let coins = 0;
    let earned = 0;
    let carry = 0;
    let collects = 0;
    let awayMs = 0;
    let slice: IdleSlice | null = null;

    /** One coin in carry units: income per second × elapsed ms × rate lands here exactly. */
    const unit = () => ctx.time.rate * 1000;
    const price = (i: number) => rows[i]!.cost + rows[i]!.step * owned[i]!;
    const perSecond = () => rows.reduce((n, row, i) => n + row.perSecond * owned[i]!, 0);
    const count = () => owned.reduce((n, k) => n + k, 0);

    function credit(units: number): void {
      carry += units;
      const whole = Math.floor(carry / unit());
      carry -= whole * unit();
      coins += whole;
      earned += whole;
    }

    function purchase(id: string): void {
      const i = rows.findIndex((r) => r.id === id);
      if (i < 0 || price(i) > coins) return;
      coins -= price(i);
      owned[i]!++;
    }

    return {
      onLoad() {
        rows = (ctx.project?.table(GENERATOR) ?? []) as readonly GeneratorRow[];
        owned = rows.map(() => 0);
        coins = earned = carry = collects = awayMs = 0;
        slice = null;
      },
      onUnload() {
        rows = [];
        owned = [];
      },
      beforeStep(_dtMs, actions, commands) {
        // A tick is 1000 / rate ms, so its income is perSecond × 1000 carry units.
        credit(perSecond() * 1000);
        for (const a of actions)
          if (a.action === COLLECT && a.pressed) {
            collects++;
            credit(COLLECT_VALUE * unit());
          }
        for (const c of commands) {
          if (c.name === ELAPSED) {
            const { ms } = c.args as { ms: number };
            awayMs += ms;
            credit(perSecond() * ms * ctx.time.rate);
          } else if (c.name === BUY) purchase((c.args as { generator: string }).generator);
        }
      },
      busy: () => count() > 0,
      snapshot: () => ({
        coins,
        earned,
        carry,
        collects,
        awayMs,
        generators: rows.map((r, i) => ({ id: r.id, owned: owned[i]!, price: price(i) })),
      }),
      restore(s) {
        coins = s.coins;
        earned = s.earned;
        carry = s.carry;
        collects = s.collects;
        awayMs = s.awayMs;
        owned = rows.map((r) => s.generators.find((g) => g.id === r.id)?.owned ?? 0);
        slice = null;
      },
      storeSlice() {
        const next = { coins, perSecond: perSecond(), owned: count() };
        if (
          slice === null ||
          slice.coins !== next.coins ||
          slice.perSecond !== next.perSecond ||
          slice.owned !== next.owned
        )
          slice = next;
        return slice;
      },
    };
  },
});

const scene: SceneDefinition = {
  v: SCENE_FORMAT_VERSION,
  game: ID,
  name: "idle-probe",
  bounds: [0, 0, 4, 3],
  settings: { physics: "none" },
  entities: [{ id: "start", type: "marker", at: [2, 1.5], tags: ["spawn"] }],
};

const COLLECTS = 10;
const order = (generator: string) => ({ command: BUY, args: { generator } });

/** A tick inside the first crank's income, its carry partway to the next coin. */
export const SAVE_AT = 60;

/**
 * Ten collects buy the first crank, which earns on screen for two seconds;
 * an hour away pays for five mills, and a longer absence, clamped to an
 * hour, carries the coins earned past the target on the tick it arrives.
 */
export const idleProbe: GenreProbe<IdleSnapshot> = {
  id: ID,
  rows: ["idle"],
  game,
  scene,
  project: { tables: { [GENERATOR]: GENERATOR_ROWS } },
  script: {
    v: 1,
    scene: scene.name,
    maxTicks: 600,
    steps: [
      // A slot between presses releases the key, so each press is its own edge.
      ...Array.from({ length: COLLECTS }, () => [{ press: COLLECT }, { wait: 1 }]).flat(),
      order("crank"),
      { wait: 120 },
      { elapse: CATCH_UP_MAX_MS },
      ...Array.from({ length: 5 }, () => order("mill")),
      // More than the clamp: only an hour of it is credited.
      { elapse: CATCH_UP_MAX_MS * 1.5 },
      { wait: 10 },
    ],
  },
  expect: { result: "won", maxTicks: 200 },
  variants: [{ name: "saved-mid-income", saveAt: SAVE_AT }],
};
