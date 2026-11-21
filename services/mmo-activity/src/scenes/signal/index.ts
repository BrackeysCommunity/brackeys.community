import type { Family } from "../../shell/kit.ts";
import { SignalModel } from "./model.ts";
import { mount } from "./scene.ts";

const signal: Family = {
  id: "signal",
  start: (layout) => new SignalModel(layout),
  mount,
};

export default signal;
