import type { PartyVersion } from "../../shell/party-registry.ts";
import { SplitPanelModel } from "./model.ts";
import { mount } from "./scene.ts";

const splitPanel: PartyVersion = {
  id: "split-panel",
  family: "rewire",
  start: (layout) => new SplitPanelModel(layout),
  mount,
};

export default splitPanel;
