/**
 * The engine project's game, which its jams.project.json doesn't name: the
 * standalone editor's page and server judge the project by it, and so does
 * the site's editor. Imports only `@jams/engine/game` and zod, so a server
 * can read it without the DOM or CSS.
 */
import { defineGame, type EngineContext } from "@jams/engine/game";
import { z } from "zod";

/** The scene an editor on the engine project opens when the URL names none. */
export const DEFAULT_SCENE = "kitchen-sink";

type Vec = { x: number; y: number };

/**
 * Where Play's camera looks: the play start when Play began from a point,
 * else the centre of the scene's bounds. The engine's primitives have no
 * actor to follow, so without this the camera stays at the origin. An edit
 * world (no `play`) leaves the camera to the editor.
 */
export function playCameraTarget(ctx: Pick<EngineContext, "play" | "bounds">): Vec | null {
  if (!ctx.play) return null;
  const at = ctx.play.at;
  if (at) return { x: at.x, y: at.y };
  const [minX, minY, maxX, maxY] = ctx.bounds;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/**
 * No types, actions or settings of its own, so the project's scenes hold
 * only the engine's primitives, and the one data table its `data/` holds.
 * A page and the server it edits through must judge the project by the
 * same game, or their schema hashes differ and the page goes read-only.
 */
export const engineEditorGame = defineGame<null>({
  id: "engine-editor",
  types: [],
  actions: [],
  tables: {
    card: {
      description: "Cards a deck holds.",
      row: {
        cost: z.number().int().min(0).describe("What playing it costs."),
        damage: z.number().int().min(0).default(0).describe("What it deals; default 0."),
      },
    },
  },
  createRuntime: (ctx) => ({ snapshot: () => null, cameraTarget: () => playCameraTarget(ctx) }),
});
