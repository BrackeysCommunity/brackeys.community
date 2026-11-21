import type { Family } from "../../shell/kit.ts";
import { DialModel } from "./model.ts";
import { mount } from "./scene.ts";

const dial: Family = {
  id: "lock-dial",
  start: (layout) => new DialModel(layout),
  mount,
};

export default dial;
