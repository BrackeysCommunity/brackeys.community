import type { Family } from "../../shell/kit.ts";
import { PinsModel } from "./model.ts";
import { mount } from "./scene.ts";

const pins: Family = {
  id: "lock-pins",
  start: (layout) => new PinsModel(layout),
  mount,
};

export default pins;
