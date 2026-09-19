// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { TimeAgo } from "@/components/ui/time-ago";
import { timeAgo } from "@/lib/format-time";
import { ServerNowContext } from "@/lib/hooks/use-date-now";

/**
 * BC-207's text half. The server builds the HTML at one instant and the
 * browser hydrates it at another, so anything rendering a relative time
 * read its own clock on each side — "10m ago" against "11m ago" whenever
 * the two straddled a minute. React answers a text mismatch by discarding
 * the hydrated tree.
 *
 * The fix is one clock per request: the root loader stamps `now`, the
 * router serializes it, and `useDateNow` returns it as its server snapshot
 * so the hydrating render repeats the server's answer before switching to
 * the live clock.
 *
 * Both halves are checked here. The control at the bottom renders the same
 * content off the ambient clock and *must* fail, because a guard that
 * cannot detect the bug it was written for proves nothing.
 */

const POSTED = Date.UTC(2026, 8, 19, 11, 50, 20);
/** 10m30s after `POSTED`, so the server renders "10m ago". */
const SERVER_NOW = Date.UTC(2026, 8, 19, 12, 0, 50);
/**
 * 11m05s after it, so an ambient clock renders "11m ago" instead. The
 * bucket `timeAgo` rounds to is what has to change: a hydration a few
 * hundred milliseconds later still mismatches whenever the elapsed time
 * crosses one, which is why the bug was steady rather than rare.
 */
const CLIENT_NOW = Date.UTC(2026, 8, 19, 12, 1, 25);

let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
  vi.useRealTimers();
});

/**
 * Renders `tree` as the server would at `SERVER_NOW`, then hydrates that
 * HTML with the clock already moved on, and reports what React had to
 * recover from.
 */
function hydrateAcrossAMinute(tree: React.ReactElement): unknown[] {
  vi.setSystemTime(SERVER_NOW);
  const html = renderToString(tree);

  vi.setSystemTime(CLIENT_NOW);
  container.innerHTML = html;

  const recovered: unknown[] = [];
  let root: ReturnType<typeof hydrateRoot>;
  act(() => {
    root = hydrateRoot(container, tree, {
      onRecoverableError: (error) => recovered.push(error),
    });
  });
  act(() => root.unmount());
  return recovered;
}

/** What the page does: the request's clock arrives with the payload. */
function WithServerClock() {
  return (
    <ServerNowContext value={SERVER_NOW}>
      <span>
        Posted <TimeAgo date={new Date(POSTED)} />
      </span>
    </ServerNowContext>
  );
}

/** What it used to do: each side asks its own clock. */
function WithAmbientClock() {
  return (
    <span>
      Posted <span>{timeAgo(new Date(POSTED))}</span>
    </span>
  );
}

describe("relative times across a hydration boundary", () => {
  it("hydrates cleanly when the request's clock comes with the page", () => {
    expect(hydrateAcrossAMinute(<WithServerClock />)).toEqual([]);
  });

  it("hydrates on the server's answer, then catches up to the live clock", () => {
    vi.setSystemTime(SERVER_NOW);
    const html = renderToString(<WithServerClock />);
    // What the browser is handed, and therefore what the hydrating render
    // has to repeat rather than improve on.
    expect(html).toContain("10m ago");

    vi.setSystemTime(CLIENT_NOW);
    container.innerHTML = html;
    let root: ReturnType<typeof hydrateRoot>;
    act(() => {
      root = hydrateRoot(container, <WithServerClock />);
    });
    // Corrected on the commit *after* hydration: the stale minute is a
    // frame long, not permanent. Pinning it would trade one bug for a
    // timestamp that never ticks.
    expect(container.textContent).toContain("11m ago");
    act(() => root.unmount());
  });

  it("control: the ambient clock still mismatches, so this guard has teeth", () => {
    expect(hydrateAcrossAMinute(<WithAmbientClock />)).not.toEqual([]);
  });
});
