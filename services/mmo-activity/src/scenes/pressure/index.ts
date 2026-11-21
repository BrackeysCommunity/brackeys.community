import type { Family } from "../../shell/kit.ts";
import { PressureModel } from "./model.ts";
import { mount } from "./scene.ts";

const pressure: Family = {
  id: "pressure",
  start: (layout) => new PressureModel(layout),
  mount,
};

export default pressure;
