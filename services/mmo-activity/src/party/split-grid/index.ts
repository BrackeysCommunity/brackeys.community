import type { PartyVersion } from "../../shell/party-registry.ts";
import { SplitGridModel } from "./model.ts";
import { mount } from "./scene.ts";

const splitGrid: PartyVersion = {
  id: "split-grid",
  family: "circuit",
  start: (layout) => new SplitGridModel(layout),
  mount,
};

export default splitGrid;
