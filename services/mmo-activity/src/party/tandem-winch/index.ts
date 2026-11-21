import type { PartyVersion } from "../../shell/party-registry.ts";
import { WinchModel } from "./model.ts";
import { mount } from "./scene.ts";

const tandemWinch: PartyVersion = {
  id: "tandem-winch",
  family: "crank",
  start: (layout) => new WinchModel(layout),
  mount,
};

export default tandemWinch;
