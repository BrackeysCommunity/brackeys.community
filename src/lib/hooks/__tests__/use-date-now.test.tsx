// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import useDateNow, { ServerNowContext } from "@/lib/hooks/use-date-now";

function Clock() {
  return <span>{useDateNow()}</span>;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useDateNow", () => {
  it("renders the request's own clock on the server, not the process clock", () => {
    const requestNow = Date.UTC(2026, 8, 19, 12, 0, 30);
    const html = renderToString(
      <ServerNowContext value={requestNow}>
        <Clock />
      </ServerNowContext>,
    );
    expect(html).toContain(String(requestNow));
  });

  it("reads the live clock once mounted on the client", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-19T12:00:30Z"));
    const { result } = renderHook(() => useDateNow());
    expect(result.current).toBe(Date.now());
  });

  it("ticks on the minute, so everything on screen rolls over together", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-19T12:00:30Z"));
    const { result } = renderHook(() => useDateNow());
    const first = result.current;

    await vi.advanceTimersByTimeAsync(20_000);
    expect(result.current).toBe(first);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(result.current).toBe(Date.UTC(2026, 8, 19, 12, 1, 0));
  });
});
