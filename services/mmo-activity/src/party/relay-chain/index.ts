import type { PartyVersion } from "../../shell/party-registry.ts";
import { RelayChainModel } from "./model.ts";
import { mount } from "./scene.ts";

const relayChain: PartyVersion = {
  id: "relay-chain",
  family: "signal",
  start: (layout) => new RelayChainModel(layout),
  mount,
};

export default relayChain;
