import type { PartyVersion } from "../../shell/party-registry.ts";
import { SwipeModel } from "./model.ts";
import { mount } from "./scene.ts";

const doubleSwipe: PartyVersion = {
  id: "double-swipe",
  family: "keycard",
  start: (layout) => new SwipeModel(layout),
  mount,
};

export default doubleSwipe;
