import type { Family } from "../../shell/kit.ts";
import { KeycardModel } from "./model.ts";
import { mount } from "./scene.ts";

const keycard: Family = {
  id: "keycard",
  start: (layout) => new KeycardModel(layout),
  mount,
};

export default keycard;
