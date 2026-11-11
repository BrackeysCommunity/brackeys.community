import type { MountUi } from "@jams/engine";

import type { TacticsSlice } from "../types";
import { createTacticsHud } from "./hud";

/** The skirmish's DOM HUD, named by the project file's `ui` key. */
export const mountTacticsHud: MountUi<TacticsSlice> = (ctx) => createTacticsHud(ctx);
