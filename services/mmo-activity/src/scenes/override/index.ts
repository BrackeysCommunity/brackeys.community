import type { Family } from "../../shell/kit.ts";
import { OverrideModel } from "./model.ts";
import { mount } from "./scene.ts";

const override: Family = {
  id: "override",
  start: (layout) => new OverrideModel(layout),
  mount,
};

export default override;
