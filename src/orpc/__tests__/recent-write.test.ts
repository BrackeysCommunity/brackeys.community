import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { markWrite, shouldBypassPublicCache } from "@/orpc/recent-write";

describe("recent-write bypass window", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens on markWrite and outlives the longest public edge TTL", () => {
    markWrite();
    expect(shouldBypassPublicCache()).toBe(true);
    // An edge copy cached the instant before the write expires 30s
    // (PUBLIC_EDGE_TTL max) after it — the window must cover that.
    vi.advanceTimersByTime(30_000);
    expect(shouldBypassPublicCache()).toBe(true);
  });

  it("closes after the window so the edge cache resumes", () => {
    markWrite();
    vi.advanceTimersByTime(46_000);
    expect(shouldBypassPublicCache()).toBe(false);
  });

  it("re-arms on every write", () => {
    markWrite();
    vi.advanceTimersByTime(40_000);
    markWrite();
    vi.advanceTimersByTime(40_000);
    expect(shouldBypassPublicCache()).toBe(true);
  });
});
