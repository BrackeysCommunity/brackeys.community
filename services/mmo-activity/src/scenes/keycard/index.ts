import type { Family } from "../../shell/kit.ts";
import { KeycardModel } from "./model.ts";
import { mount } from "./scene.ts";

const keycard: Family = {
  id: "keycard",
  // A swipe is read off the gauge, which takes longer than a glance.
  hintMs: 5000,
  start: (layout) => new KeycardModel(layout),
  mount,
};

export default keycard;
