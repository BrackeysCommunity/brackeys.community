/**
 * Where the dev server co-edits projects. Mirrors `SCENE_COLLAB_PATH` and
 * `PROJECT_ROUTE` from `@jams/engine/vite`, a Node entry the browser can't
 * import, and the scene kind's name from `@jams/engine/project`, kept out of
 * the page's bundle; `scene-doc.test.ts` keeps them in step.
 */
export const SCENE_COLLAB_PATH = "/__scene-collab";

/** The dev server's project routes, blob uploads among them. */
export const DEV_PROJECT_ROUTE = "/__project";

/** The project the game room's scenes belong to: the platformer's `jams.project.json`. */
export const SCENE_PROJECT = "platformer";

/** The registry kind of a scene asset. */
export const SCENE_KIND = "scene";

export function sceneCollabUrl(loc: Pick<Location, "protocol" | "host"> = window.location): string {
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}${SCENE_COLLAB_PATH}`;
}
