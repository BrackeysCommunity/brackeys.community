import type { PartyVersion } from "../../shell/party-registry.ts";
import { BombSquadModel } from "./model.ts";
import { mount } from "./scene.ts";

const bombSquad: PartyVersion = {
  id: "bomb-squad",
  family: "fuse",
  start: (layout) => new BombSquadModel(layout),
  mount,
};

export default bombSquad;
