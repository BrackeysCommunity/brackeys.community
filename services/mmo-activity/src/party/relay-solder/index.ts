import type { PartyVersion } from "../../shell/party-registry.ts";
import { SolderModel } from "./model.ts";
import { mount } from "./scene.ts";

const relaySolder: PartyVersion = {
  id: "relay-solder",
  family: "splice",
  start: (layout) => new SolderModel(layout),
  mount,
};

export default relaySolder;
