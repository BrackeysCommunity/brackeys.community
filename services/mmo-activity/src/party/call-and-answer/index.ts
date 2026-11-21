import type { PartyVersion } from "../../shell/party-registry.ts";
import { CallModel } from "./model.ts";
import { mount } from "./scene.ts";

const callAndAnswer: PartyVersion = {
  id: "call-and-answer",
  family: "override",
  start: (layout) => new CallModel(layout),
  mount,
};

export default callAndAnswer;
