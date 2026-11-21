import type { PartyVersion } from "../../shell/party-registry.ts";
import { PanelModel } from "./model.ts";
import { mount } from "./scene.ts";

const panelArray: PartyVersion = {
  id: "panel-array",
  family: "scrub",
  start: (layout) => new PanelModel(layout),
  mount,
};

export default panelArray;
