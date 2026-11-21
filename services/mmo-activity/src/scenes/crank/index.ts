import type { Family } from "../../shell/kit.ts";
import { CrankModel } from "./model.ts";
import { mount } from "./scene.ts";

const crank: Family = {
  id: "crank",
  start: (layout) => new CrankModel(layout),
  mount,
};

export default crank;
