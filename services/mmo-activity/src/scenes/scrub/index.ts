import type { Family } from "../../shell/kit.ts";
import { ScrubModel } from "./model.ts";
import { mount } from "./scene.ts";

const scrub: Family = {
  id: "scrub",
  start: (layout) => new ScrubModel(layout),
  mount,
};

export default scrub;
