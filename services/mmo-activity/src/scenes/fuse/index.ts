import type { Family } from "../../shell/kit.ts";
import { FuseModel } from "./model.ts";
import { mount } from "./scene.ts";

const fuse: Family = {
  id: "fuse",
  start: (layout) => new FuseModel(layout),
  mount,
};

export default fuse;
