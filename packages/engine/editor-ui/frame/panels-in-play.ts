import { createContext, useContext } from "react";

import { STORAGE_PREFIX } from "../host";

/** Where the viewer's Panels in Play choice is kept. */
export const PANELS_IN_PLAY_KEY = `${STORAGE_PREFIX}panels-in-play`;

export const PANELS_IN_PLAY_TOOLTIP =
  "Keep the panels beside the game while you play, for the Play inspector, the Spawned group, the Event log and Perf";

/** The frame's Panels in Play switch: off by default, so Play fills the window. */
export const PanelsInPlayContext = createContext<[boolean, (on: boolean) => void] | null>(null);

export const usePanelsInPlay = () => useContext(PanelsInPlayContext);
