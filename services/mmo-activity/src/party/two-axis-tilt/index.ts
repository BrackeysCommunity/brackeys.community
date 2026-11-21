import type { PartyVersion } from "../../shell/party-registry.ts";
import { TwoAxisModel } from "./model.ts";
import { mount } from "./scene.ts";

const twoAxisTilt: PartyVersion = {
  id: "two-axis-tilt",
  family: "lock-maze",
  start: (layout) => new TwoAxisModel(layout),
  mount,
};

export default twoAxisTilt;
