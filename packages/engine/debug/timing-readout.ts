import type { RunTiming } from "../runtime/timing";

/** `localStorage` key: `"1"` switches timing on, anything else leaves it as the host set it. */
export const TIMING_STORAGE_KEY = "debug-timing";
/** Marks the readout: a `<script type="application/json">` in the body whose text is the `TimingReport`. */
export const TIMING_ATTRIBUTE = "data-jams-timing";

/** Overlay updates between two looks at the flag and writes of the readout: about half a second. */
const REFRESH_UPDATES = 30;

export type TimingReadout = {
  /** Once per overlay update; every `REFRESH_UPDATES`th follows the flag and rewrites the readout. */
  update: () => void;
  destroy: () => void;
};

function flagged(): boolean {
  try {
    return localStorage.getItem(TIMING_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Follows the `debug-timing` flag: set, `timing` is reset and enabled;
 * cleared, it goes back to how the host had it. While `timing` is enabled
 * its report is on the page as JSON, in an inert element nothing lays out.
 */
export function createTimingReadout(timing: RunTiming): TimingReadout {
  const hostEnabled = timing.enabled;
  let flag = false;
  let el: HTMLScriptElement | null = null;
  let wait = 0;

  function clear(): void {
    el?.remove();
    el = null;
  }

  function update(): void {
    if (wait-- > 0) return;
    wait = REFRESH_UPDATES - 1;
    const now = flagged();
    if (now !== flag) {
      flag = now;
      if (now) timing.reset();
      timing.enabled = now || hostEnabled;
    }
    if (!timing.enabled || typeof document === "undefined") return clear();
    if (!el) {
      el = document.createElement("script");
      el.type = "application/json";
      el.setAttribute(TIMING_ATTRIBUTE, "");
      document.body.append(el);
    }
    el.textContent = JSON.stringify(timing.report());
  }

  function destroy(): void {
    clear();
    timing.enabled = hostEnabled;
  }

  return { update, destroy };
}
