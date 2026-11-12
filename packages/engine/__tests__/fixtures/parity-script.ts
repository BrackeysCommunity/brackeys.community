import type { ProbeInput } from "../../headless/types";
import inputs from "./parity-inputs.json";

/** The test game's script on `engine-yard.json`: walks through the sensor both ways, shoves the crate and pushes up. */
export const ENGINE_PARITY_SCRIPT = {
  ticks: 600,
  inputs: inputs as NonNullable<ProbeInput["inputs"]>,
} satisfies ProbeInput;
