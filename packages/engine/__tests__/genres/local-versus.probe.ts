import { z } from "zod";

import { defineGame } from "../../game/define";
import type { Binding, EngineContext } from "../../game/types";
import type { InputScriptStepV2, InputScriptV2 } from "../../headless/playtest-types";
import { createMotionBody, type MotionBody } from "../../motion/body";
import { createTopDownController, type TopDownController } from "../../motion/top-down";
import type { EntityDef, Pt, SceneDefinition } from "../../scene/types";
import type { Vec2 } from "../../types";
import type { GenreProbe } from "./harness";

const ID = "local-versus";
/** The tag on the two markers the fighters start at, seat 0's first by id. */
const FIGHTER = "fighter";
const SEATS = 2;
/** Raised on the struck fighter's entity, with the striker as `other` and the hp left. */
const HIT = `${ID}:hit`;
/** Raised on the winner's entity once the other's hp runs out. */
const KO = `${ID}:ko`;
const WINS = ["seat-0-wins", "seat-1-wins"] as const;

const TUNING = { maxSpeed: 3, accel: 30, decel: 30 };
/** Half a fighter's square pushbox, m. */
const HALF = 0.2;
/** Centre to centre, m: a strike lands on a fighter at most this far away. */
const REACH = 0.7;
/** How far a landed strike shoves the struck fighter away from the striker, m. */
const KNOCKBACK = 0.3;
/** Ticks after a strike before the same seat can strike again. */
const COOLDOWN = 12;
const HP = 3;

export type FighterSnapshot = {
  position: Vec2;
  velocity: Vec2;
  hp: number;
  /** Ticks before this seat can strike again. */
  cooldown: number;
  joined: boolean;
};
export type LocalVersusSnapshot = { fighters: FighterSnapshot[]; started: boolean } | null;

const key = (code: string, axis: "x" | "y", value: number, player: number): Binding => ({
  device: "key",
  code,
  axis,
  value,
  player,
});

/** Seat 0 on WASD and Space, seat 1 on the arrows and Enter; a pad drives whichever seat it joined. */
const MOVE_KEYS: readonly Binding[] = [
  key("KeyA", "x", -1, 0),
  key("KeyD", "x", 1, 0),
  key("KeyW", "y", -1, 0),
  key("KeyS", "y", 1, 0),
  key("ArrowLeft", "x", -1, 1),
  key("ArrowRight", "x", 1, 1),
  key("ArrowUp", "y", -1, 1),
  key("ArrowDown", "y", 1, 1),
];

const distance = (a: Vec2, b: Vec2) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
};

const inReach = (snap: LocalVersusSnapshot) => {
  const [a, b] = snap?.fighters ?? [];
  return !!a && !!b && a.hp > 0 && b.hp > 0 && distance(a.position, b.position) <= REACH;
};

type Fighter = {
  id: string;
  body: MotionBody;
  move: TopDownController;
  hp: number;
  cooldown: number;
};

const game = defineGame<LocalVersusSnapshot>({
  id: ID,
  types: [],
  actions: [
    {
      action: "move",
      kind: "vector",
      bindings: [{ device: "pad", stick: "left" }, ...MOVE_KEYS],
      description: "Move the seat's fighter.",
    },
    {
      action: "strike",
      bindings: [
        { device: "pad", button: "south" },
        { device: "key", code: "Space", player: 0 },
        { device: "key", code: "Enter", player: 1 },
      ],
      description: "Strike the other fighter when it is in reach.",
    },
  ],
  input: { players: { max: SEATS, join: "press" } },
  world: { physics: "none" },
  time: { kind: "fixed" },
  play: {
    focus: (snap) => {
      const [a, b] = snap?.fighters ?? [];
      if (!a || !b) return null;
      return { x: (a.position.x + b.position.x) / 2, y: (a.position.y + b.position.y) / 2 };
    },
    results: WINS,
    outcome({ events }) {
      const ko = events.find((e) => e.type === KO);
      if (!ko) return null;
      const seat = (ko.data as { player: number }).player;
      return {
        result: WINS[seat]!,
        cause: `seat ${seat} knocked the other out`,
        entityId: ko.entityId,
      };
    },
    predicates: {
      inReach: {
        description: "Whether the fighters stand within striking reach of each other.",
        arg: z.boolean(),
        test: (arg, state) => inReach(state.snapshot) === arg,
      },
    },
  },
  createRuntime(ctx: EngineContext) {
    let fighters: Fighter[] = [];
    let started = false;

    const joined = (seat: number) => ctx.input.players()[seat]?.joined ?? false;

    return {
      onLoad(scene) {
        const starts = scene.entities
          .filter((e) => e.type === "marker" && (e.tags as string[] | undefined)?.includes(FIGHTER))
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .slice(0, SEATS);
        fighters = starts.map((start) => {
          const [x, y] = start.at as Pt;
          const body = createMotionBody(
            ctx,
            { id: start.id, type: start.type },
            { x, y },
            { shape: { type: "box", cx: 0, cy: 0, hw: HALF, hh: HALF, rotDeg: 0 } },
          );
          return {
            id: start.id,
            body,
            move: createTopDownController(body, TUNING),
            hp: HP,
            cooldown: 0,
          };
        });
      },
      onUnload() {
        fighters = [];
        started = false;
      },
      beforeStep(dtMs) {
        if (fighters.length < SEATS) return;
        // The round starts once every seat has a device; until then nobody moves.
        started ||= fighters.every((_, seat) => joined(seat));
        if (!started || fighters.some((f) => f.hp <= 0)) return;

        const strikes: [striker: number, target: number][] = [];
        fighters.forEach((f, seat) => {
          if (f.cooldown > 0) f.cooldown--;
          f.move.step(dtMs, ctx.input.vector("move", seat));
          if (!ctx.input.pressed("strike", seat) || f.cooldown > 0) return;
          f.cooldown = COOLDOWN;
          const target = 1 - seat;
          const other = fighters[target]!;
          if (distance(f.body.position(), other.body.position()) <= REACH)
            strikes.push([seat, target]);
        });
        // Strikes on one tick land together, judged from where both stood, so a trade hits both.
        const from = fighters.map((f) => f.body.position());
        for (const [striker, target] of strikes) {
          const f = fighters[target]!;
          const a = from[striker]!;
          const b = from[target]!;
          const d = distance(a, b) || 1;
          f.hp--;
          f.body.move({ x: ((b.x - a.x) / d) * KNOCKBACK, y: ((b.y - a.y) / d) * KNOCKBACK });
          ctx.emit({
            type: HIT,
            entityId: f.id,
            other: fighters[striker]!.id,
            at: f.body.position(),
            data: { hp: f.hp },
          });
        }
        const down = fighters.findIndex((f) => f.hp <= 0);
        if (down >= 0) {
          const winner = fighters[1 - down]!;
          ctx.emit({
            type: KO,
            entityId: winner.id,
            other: fighters[down]!.id,
            at: winner.body.position(),
            data: { player: 1 - down },
          });
        }
      },
      snapshot() {
        if (fighters.length < SEATS) return null;
        return {
          started,
          fighters: fighters.map((f, seat) => ({
            position: f.body.position(),
            velocity: f.move.velocity(),
            hp: f.hp,
            cooldown: f.cooldown,
            joined: joined(seat),
          })),
        };
      },
      // The bodies come back with the world save, and the seats with its input.
      restore(s) {
        if (!s) return;
        started = s.started;
        fighters.forEach((f, seat) => {
          const saved = s.fighters[seat];
          if (!saved) return;
          f.hp = saved.hp;
          f.cooldown = saved.cooldown;
        });
      },
    };
  },
});

const solid = (id: string, cx: number, cy: number, hw: number, hh: number): EntityDef => ({
  id,
  type: "solid",
  shape: ["box", cx, cy, hw, hh],
});

/** An 8 × 4.5 m walled arena with the fighters at either end. */
const scene: SceneDefinition = {
  v: 4,
  game: ID,
  name: "local-versus-probe",
  bounds: [0, 0, 8, 4.5],
  settings: { gravity: [0, 0] },
  entities: [
    solid("north", 4, 0.1, 4, 0.1),
    solid("south", 4, 4.4, 4, 0.1),
    solid("west", 0.1, 2.25, 0.1, 2.05),
    solid("east", 7.9, 2.25, 0.1, 2.05),
    { id: "fighter-0", type: "marker", at: [1.5, 2.25], tags: [FIGHTER] },
    { id: "fighter-1", type: "marker", at: [6.5, 2.25], tags: [FIGHTER] },
  ],
};

const strike = (move: Pt): InputScriptStepV2 => ({ hold: ["strike"], set: { move }, for: 1 });

/**
 * Seat 0 joins on the keyboard and charges; seat 1 joins on a pad a little
 * later (nobody moves until it does), swings wide and meets it head on. Seat
 * 0 strikes whenever the other is in reach, seat 1 answers once and then
 * shoves, and seat 0's third strike knocks it out.
 */
const script: InputScriptV2 = {
  v: 2,
  scene: scene.name,
  players: SEATS,
  maxTicks: 900,
  tracks: [
    {
      player: 0,
      steps: [
        { join: "keyboard" },
        ...[1, 2, 3].flatMap((): InputScriptStepV2[] => [
          { set: { move: [1, 0] }, until: { inReach: true }, max: 300 },
          strike([1, 0]),
          { set: { move: [1, 0] }, for: COOLDOWN },
        ]),
      ],
    },
    {
      player: 1,
      steps: [
        { wait: 20 },
        { join: "pad:0" },
        { set: { move: [-0.8, 0.6] }, for: 25 },
        { set: { move: [-0.8, -0.6] }, for: 25 },
        { set: { move: [-1, 0] }, until: { inReach: true }, max: 300 },
        strike([-1, 0]),
        { set: { move: [-0.6, 0] }, for: 120 },
      ],
    },
  ],
};

/**
 * Two seats on vector sticks in one arena, physics none: motion bodies on the
 * geometry backend, so the run and its replay are the same on every platform.
 */
export const localVersusProbe: GenreProbe<LocalVersusSnapshot> = {
  id: ID,
  rows: ["local-multiplayer", "fighting"],
  pending: {
    "local-multiplayer": "M22 (split and shared cameras)",
    fighting: "M22 (per-frame hitboxes), M27 (rollback)",
  },
  game,
  scene,
  script,
  expect: { result: "seat-0-wins", maxTicks: 200 },
  variants: [
    { name: "gravity-sideways", settings: { gravity: [12, 0] } },
    // After the first exchange, a strike still cooling down.
    { name: "saved-mid-round", saveAt: 80 },
  ],
};
