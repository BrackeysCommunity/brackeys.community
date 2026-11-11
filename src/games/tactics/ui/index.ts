import type { MountUi } from "@jams/engine";

import { TACTICS_LEVELS, type TacticsFlowSlice } from "../runtime";
import { createTacticsHud } from "./hud";
import { createTacticsMenu } from "./menu";

/** The skirmish's DOM HUD and its title and result screens, named by the project file's `ui` key. */
export const mountTacticsHud: MountUi<TacticsFlowSlice> = (ctx) => {
  const hud = createTacticsHud(ctx);
  const menu = createTacticsMenu(ctx, { levels: TACTICS_LEVELS });
  return {
    cancel: () => hud.cancel?.() ?? false,
    destroy() {
      menu.destroy();
      hud.destroy();
    },
  };
};
