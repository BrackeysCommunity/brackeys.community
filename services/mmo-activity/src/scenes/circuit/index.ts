import type { Family } from "../../shell/kit.ts";
import { CircuitModel } from "./model.ts";
import { mount } from "./scene.ts";

const circuit: Family = {
  id: "circuit",
  start: (layout) => new CircuitModel(layout),
  mount,
};

export default circuit;
