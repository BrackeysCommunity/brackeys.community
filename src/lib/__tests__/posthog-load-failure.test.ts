import { describe, expect, it, vi } from "vite-plus/test";

// @vitest-environment jsdom

/**
 * The unhappy half of the deferred load in `@/lib/product-insights`: the chunk is
 * genuinely unreachable sometimes — an offline visitor, or a deploy that
 * rotated asset hashes while a tab sat open. Lives in its own file because
 * the failing `posthog-js` mock is module-scoped and would leak into the
 * happy-path tests next door.
 */
vi.mock("posthog-js", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

vi.mock("@/env", () => ({
  env: { VITE_POSTHOG_KEY: "phc_test", VITE_POSTHOG_HOST: undefined },
}));

vi.stubGlobal("__APP_VERSION__", "0.0.0-test");

const idleTasks: Array<() => void> = [];
vi.stubGlobal("requestIdleCallback", (fn: () => void) => {
  idleTasks.push(fn);
  return 0;
});

describe("when the posthog-js chunk can't be fetched", () => {
  it("swallows the rejection and stops queueing instead of leaking calls", async () => {
    const { initAnalytics, captureEvent, identifyUser } = await import("@/lib/product-insights");

    initAnalytics();
    for (const task of idleTasks) task();
    // Let the rejected import settle so the catch has run.
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Without the catch these would pile up for the life of the page behind
    // a client that is never coming, and the rejection would surface as an
    // uncaught error.
    expect(() => {
      for (let i = 0; i < 100; i++) captureEvent("$pageview");
      identifyUser({ id: "user-1" });
    }).not.toThrow();
  });
});
