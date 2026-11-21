import type { Family } from "../../shell/kit.ts";
import { SpliceModel } from "./model.ts";
import { mount } from "./scene.ts";

const splice: Family = {
  id: "splice",
  start: (layout) => new SpliceModel(layout),
  mount,
};

export default splice;
