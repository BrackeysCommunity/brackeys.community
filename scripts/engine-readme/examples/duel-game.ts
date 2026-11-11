import { defineGame, type Binding, type EngineContext } from "@jams/engine/game";
import type { Pt, SceneDefinition } from "@jams/engine/scene";

export type Runner = { x: number; y: number; joined: boolean };
export type DuelSnapshot = { runners: Runner[]; winner: number | null };

/** m/s at full stick. */
const SPEED = 4;
/** How close to the flag a runner must get, m. */
const REACH = 0.25;

const key = (code: string, axis: "x" | "y", value: number, player: number): Binding => ({
  device: "key",
  code,
  axis,
  value,
  player,
});

/** Two seats race to the flag: seat 0 on WASD, seat 1 on the arrows, either on a pad's left stick. */
export const duelGame = defineGame<DuelSnapshot>({
  id: "duel",
  types: [],
  actions: [
    {
      action: "move",
      kind: "vector",
      bindings: [
        key("KeyA", "x", -1, 0),
        key("KeyD", "x", 1, 0),
        key("KeyW", "y", -1, 0),
        key("KeyS", "y", 1, 0),
        key("ArrowLeft", "x", -1, 1),
        key("ArrowRight", "x", 1, 1),
        key("ArrowUp", "y", -1, 1),
        key("ArrowDown", "y", 1, 1),
        { device: "pad", stick: "left" },
      ],
      description: "Run.",
    },
    {
      action: "taunt",
      bindings: [
        { device: "key", code: "Space", player: 0 },
        { device: "key", code: "Enter", player: 1 },
        { device: "pad", button: "south" },
      ],
      description: "Wave at the other runner.",
    },
  ],
  // A device's first press takes the lowest free seat.
  input: { players: { max: 2, join: "press" }, deadzone: 0.2 },
  world: { physics: "none" },
  play: {
    results: ["seat-0-wins", "seat-1-wins"],
    outcome: ({ snapshot }) =>
      snapshot.winner === null ? null : { result: `seat-${snapshot.winner}-wins` },
  },
  createRuntime(ctx: EngineContext) {
    let runners: Runner[] = [];
    let flag: Pt = [0, 0];
    let winner: number | null = null;

    return {
      onLoad(scene) {
        const marker = (tag: string) =>
          scene.entities.filter(
            (e) => e.type === "marker" && (e.tags as string[] | undefined)?.includes(tag),
          );
        runners = marker("runner").map((e) => {
          const [x, y] = e.at as Pt;
          return { x, y, joined: false };
        });
        flag = (marker("flag")[0]?.at as Pt | undefined) ?? [0, 0];
        winner = null;
      },
      beforeStep(dtMs) {
        if (winner !== null) return;
        runners.forEach((r, seat) => {
          r.joined = ctx.input.players()[seat]?.joined ?? false;
          const v = ctx.input.vector("move", seat);
          r.x += v.x * SPEED * (dtMs / 1000);
          r.y += v.y * SPEED * (dtMs / 1000);
          const dx = flag[0] - r.x;
          const dy = flag[1] - r.y;
          if (winner === null && Math.sqrt(dx * dx + dy * dy) <= REACH) winner = seat;
        });
      },
      snapshot: () => ({ runners: runners.map((r) => ({ ...r })), winner }),
    };
  },
});

/** A 10 × 4 m field: two lanes, one flag at the far end of the top lane. */
export const field: SceneDefinition = {
  v: 4,
  game: "duel",
  name: "field",
  bounds: [0, 0, 10, 4],
  settings: { physics: "none" },
  entities: [
    { id: "lane-0", type: "marker", at: [1, 1], tags: ["runner"] },
    { id: "lane-1", type: "marker", at: [1, 3], tags: ["runner"] },
    { id: "flag", type: "marker", at: [9, 1], tags: ["flag"] },
  ],
};
