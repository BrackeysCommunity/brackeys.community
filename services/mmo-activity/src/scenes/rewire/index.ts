import type { Family } from "../../shell/kit.ts";
import { RewireModel } from "./model.ts";
import { mount } from "./scene.ts";

const rewire: Family = {
  id: "rewire",
  start: (layout) => new RewireModel(layout),
  mount,
};

export default rewire;
