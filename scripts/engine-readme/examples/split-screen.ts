import type { GameInstance, ViewportDef } from "@jams/engine";
import { defineGame, type EngineContext } from "@jams/engine/game";

/** Two halves, each following one seat, and a minimap of the whole scene over the seam. */
export const sideBySide: ViewportDef[] = [
  { rect: [0, 0, 0.5, 1], frame: { player: 0 }, border: { width: 2, color: 0x101820 } },
  { rect: [0.5, 0, 0.5, 1], frame: { player: 1 }, border: { width: 2, color: 0x101820 } },
  { rect: [0.4, 0.74, 0.2, 0.24], frame: "scene", layers: ["terrain", "gameplay"] },
];

const SOLO: ViewportDef[] = [{ rect: [0, 0, 1, 1], frame: "main" }];

/** Splits the screen once a second seat joins, and joins it back when one leaves. */
export function fitSeats(game: Pick<GameInstance, "setViewports">, seats: number): void {
  game.setViewports(seats > 1 ? sideBySide : SOLO);
}

/** The world point under a click, through whichever viewport it landed in. */
export function pointUnder(
  game: Pick<GameInstance, "viewportAt" | "clientToWorld">,
  clientX: number,
  clientY: number,
) {
  const viewport = game.viewportAt(clientX, clientY);
  return viewport === null
    ? null
    : { viewport, at: game.clientToWorld(clientX, clientY, viewport) };
}

/** Each seat's runner is that seat's camera target; with one seat the camera frames both. */
export const relayGame = defineGame({
  id: "relay",
  types: [],
  actions: [],
  world: { physics: "none" },
  createRuntime: (ctx: EngineContext) => ({
    cameraTargets: () =>
      ["red", "blue"].flatMap((id, player) => {
        const pose = ctx.poses.get(id);
        return pose ? [{ at: { x: pose.x, y: pose.y }, player }] : [];
      }),
    snapshot: () => null,
  }),
});
