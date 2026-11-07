import type { ProbeInput } from "@jams/engine/headless";

import golden from "./m1-golden.json";

/**
 * The golden right-route on `test-yard`: 600 ticks of running, jumping,
 * grappling and dashing. The parity test plays it under both Rapier flavours.
 */
export const PARITY_SCRIPT = {
  ticks: golden.scripts["right-route"].ticks,
  inputs: golden.scripts["right-route"].inputs as NonNullable<ProbeInput["inputs"]>,
} satisfies ProbeInput;
