import type { Family } from "../../shell/kit.ts";
import { MazeModel } from "./model.ts";
import { mount } from "./scene.ts";

const maze: Family = {
  id: "lock-maze",
  start: (layout) => new MazeModel(layout),
  mount,
};

export default maze;
