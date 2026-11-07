/**
 * Where the dev server co-edits scenes. Mirrors `SCENE_COLLAB_PATH` and
 * `sceneDocName` from `@jams/engine/vite`, which is a Node entry the browser
 * can't import; `scene-collab.test.ts` keeps the two in step.
 */
export const SCENE_COLLAB_PATH = "/__scene-collab";

export const sceneDocName = (name: string) => `scene:${name}`;

export function sceneCollabUrl(loc: Pick<Location, "protocol" | "host"> = window.location): string {
  return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}${SCENE_COLLAB_PATH}`;
}
