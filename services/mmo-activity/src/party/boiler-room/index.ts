import type { PartyVersion } from "../../shell/party-registry.ts";
import { BoilerModel } from "./model.ts";
import { mount } from "./scene.ts";

const boilerRoom: PartyVersion = {
  id: "boiler-room",
  family: "pressure",
  start: (layout) => new BoilerModel(layout),
  mount,
};

export default boilerRoom;
