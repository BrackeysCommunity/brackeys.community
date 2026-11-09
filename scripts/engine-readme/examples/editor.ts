import "@jams/engine/editor-ui/style.css";
import * as hocuspocus from "@hocuspocus/provider";
import { devProjectHost, mountSceneEditor } from "@jams/engine/editor-ui";

import { coinGame } from "./coin-game";

mountSceneEditor(document.getElementById("editor")!, {
  host: devProjectHost({ hocuspocus }),
  game: coinGame,
  project: "coin-game",
  rapier: () => import("@dimforge/rapier2d"),
});
