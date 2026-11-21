import type { PartyVersion } from "../../shell/party-registry.ts";
import { TwoHandModel } from "./model.ts";
import { mount } from "./scene.ts";

const twoHandLock: PartyVersion = {
  id: "two-hand-lock",
  family: "lock-dial",
  start: (layout) => new TwoHandModel(layout),
  mount,
};

export default twoHandLock;
