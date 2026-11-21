import type { PartyVersion } from "../../shell/party-registry.ts";
import { BigRewireModel } from "./model.ts";
import { mount } from "./scene.ts";

const bigRewire: PartyVersion = {
  id: "big-rewire",
  family: "rewire",
  start: (layout) => new BigRewireModel(layout),
  mount,
};

export default bigRewire;
