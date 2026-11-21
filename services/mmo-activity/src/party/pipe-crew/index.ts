import type { PartyVersion } from "../../shell/party-registry.ts";
import { PipeModel } from "./model.ts";
import { mount } from "./scene.ts";

const pipeCrew: PartyVersion = {
  id: "pipe-crew",
  family: "leak",
  start: (layout) => new PipeModel(layout),
  mount,
};

export default pipeCrew;
