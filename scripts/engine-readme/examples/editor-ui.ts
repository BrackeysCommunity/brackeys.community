import "@jams/engine/editor-ui/style.css";
import * as hocuspocus from "@hocuspocus/provider";
import { devProjectHost, mountSceneEditor } from "@jams/engine/editor-ui";

import { coinGame } from "./coin-game";

/** Opens the project `dev-server.ts` serves in `#editor`, on the same dev server. */
export function openEditor(element: HTMLElement, project: string) {
  return mountSceneEditor(element, {
    host: devProjectHost({ hocuspocus }),
    game: coinGame,
    project,
    rapier: () => import("@dimforge/rapier2d"),
  });
}
