import type { Family } from "../../shell/kit.ts";
import { LeakModel } from "./model.ts";
import { mount } from "./scene.ts";

const leak: Family = {
  id: "leak",
  start: (layout) => new LeakModel(layout),
  mount,
};

export default leak;
