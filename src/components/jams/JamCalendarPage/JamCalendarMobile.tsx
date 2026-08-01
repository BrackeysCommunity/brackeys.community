import { JamCalendarLayout } from "./JamCalendarDesktop";
import type { JamCalendarLayoutProps } from "./shared-types";

/**
 * Stacked touch layout — same composition as desktop, with stacked hero
 * stats and the compact (2-lane) calendar density.
 */
export function JamCalendarMobile(props: JamCalendarLayoutProps) {
  return <JamCalendarLayout {...props} compact />;
}
