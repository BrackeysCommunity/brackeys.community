import { arrivalWords, type SwapTiming } from "../../../game/live";
import type { PublishChannel } from "../../host";

/** The channels in the order a version travels them. */
export const LIVE_CHANNELS = ["preview", "production"] as const satisfies readonly PublishChannel[];

/** The tooltip on a production move (Promote, Roll back, Stop) for an editor who isn't a publisher. */
export const PUBLISHERS_ONLY = "Only publishers can change production.";

/** The tooltip on the Publish scene dialog's Production choice for an editor who isn't a publisher. */
export const PRODUCTION_PUBLISHERS_ONLY = "Only publishers can choose this.";

/** What a move of `version` to production asks first. */
export const productionConfirmText = (version: string, timing: SwapTiming): string =>
  `Players will get ${version} ${arrivalWords(timing)}. You can roll back or stop it at any time.`;

/** The toast after a version is published or moved; `channel` null when nothing points at it. */
export const liveOnText = (version: string, channel: PublishChannel | null): string =>
  channel ? `${version} is live on ${channel}.` : `${version} is published.`;
