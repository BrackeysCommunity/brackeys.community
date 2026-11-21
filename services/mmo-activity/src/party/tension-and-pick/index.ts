import type { PartyVersion } from "../../shell/party-registry.ts";
import { TensionPickModel } from "./model.ts";
import { mount } from "./scene.ts";

const tensionAndPick: PartyVersion = {
  id: "tension-and-pick",
  family: "lock-pins",
  start: (layout) => new TensionPickModel(layout),
  mount,
};

export default tensionAndPick;
