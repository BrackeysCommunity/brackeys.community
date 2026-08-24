import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// @vitest-environment jsdom

/**
 * The deferred-load path in `@/lib/product-insights`: posthog-js is imported at idle
 * time, so every call made before it lands has to queue and replay in order.
 * That queue is the part with no analogue in the old eager module, so it is
 * the part worth pinning down.
 */

const init = vi.fn();
const register = vi.fn();
const capture = vi.fn();
const identify = vi.fn();
const setConfig = vi.fn();

vi.mock("posthog-js", () => ({
  default: {
    init,
    register,
    capture,
    identify,
    reset: vi.fn(),
    captureException: vi.fn(),
    set_config: setConfig,
  },
}));

vi.mock("@/env", () => ({
  env: { VITE_POSTHOG_KEY: "phc_test", VITE_POSTHOG_HOST: undefined },
}));

vi.stubGlobal("__APP_VERSION__", "0.0.0-test");

/** `initAnalytics` schedules via requestIdleCallback; run it on demand. */
let idleTasks: Array<() => void> = [];
vi.stubGlobal("requestIdleCallback", (fn: () => void) => {
  idleTasks.push(fn);
  return 0;
});
const flushIdle = async () => {
  const tasks = idleTasks;
  idleTasks = [];
  for (const task of tasks) task();
  // let the dynamic import + init settle
  await vi.waitFor(() => expect(init).toHaveBeenCalled());
};

beforeEach(() => {
  vi.resetModules();
  idleTasks = [];
  localStorage.clear();
  for (const fn of [init, register, capture, identify, setConfig]) fn.mockClear();
});

afterEach(() => localStorage.clear());

describe("deferred PostHog load", () => {
  it("does not import posthog-js until idle time", async () => {
    const { initAnalytics, captureEvent } = await import("@/lib/product-insights");

    initAnalytics();
    captureEvent("$pageview");

    // Scheduled, not run: nothing has initialised and nothing was captured.
    expect(init).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
  });

  it("replays queued calls, in order, once the client lands", async () => {
    const { initAnalytics, captureEvent, identifyUser } = await import("@/lib/product-insights");

    initAnalytics();
    captureEvent("$pageview");
    identifyUser({ id: "user-1", email: "a@b.c", name: "Ada" });

    await flushIdle();

    expect(identify).toHaveBeenCalledWith("user-1", { email: "a@b.c", name: "Ada" });
    // The URL and timestamp are pinned when the call was made, not when the
    // chunk landed — otherwise a landing-page view gets filed against
    // whatever page the visitor navigated to during the idle window.
    const [event, properties, options] = capture.mock.calls[0]!;
    expect(event).toBe("$pageview");
    expect(properties.$current_url).toBe(window.location.href);
    expect(properties.$pathname).toBe(window.location.pathname);
    expect(options.timestamp).toBeInstanceOf(Date);
    // init must precede any replayed call, or the capture lands on a
    // client that has no key yet.
    expect(init.mock.invocationCallOrder[0]).toBeLessThan(capture.mock.invocationCallOrder[0]!);
    expect(capture.mock.invocationCallOrder[0]!).toBeLessThan(
      identify.mock.invocationCallOrder[0]!,
    );
  });

  it("captures straight through once loaded, without re-queuing", async () => {
    const { initAnalytics, captureEvent } = await import("@/lib/product-insights");

    initAnalytics();
    await flushIdle();
    captureEvent("$pageview");

    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("never loads posthog-js at all for an opted-out visitor", async () => {
    localStorage.setItem("brackeys-analytics", "off");
    const { initAnalytics, captureEvent } = await import("@/lib/product-insights");

    initAnalytics();
    captureEvent("$pageview");
    for (const task of idleTasks) task();

    expect(idleTasks).toHaveLength(0);
    expect(init).not.toHaveBeenCalled();
  });

  it("stands down entirely on an opt-out made while the load was in flight", async () => {
    const { initAnalytics, setAnalyticsEnabled, captureEvent, identifyUser } =
      await import("@/lib/product-insights");

    initAnalytics();
    // Queued behind the opt-out, and the queue is FIFO: an identify carries
    // email and name, so replaying it before the opt-out took effect would
    // transmit exactly what the switch exists to prevent.
    captureEvent("$pageview");
    identifyUser({ id: "user-1", email: "a@b.c", name: "Ada" });
    setAnalyticsEnabled(false);

    for (const task of idleTasks) task();
    idleTasks = [];
    await new Promise((resolve) => setTimeout(resolve, 20));

    // `init()` puts the /flags request on the wire on its own, so honouring
    // the opt-out means never calling it — not filtering afterwards.
    expect(init).not.toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(identify).not.toHaveBeenCalled();
  });

  it("starts a fresh load when the visitor opts back in after standing down", async () => {
    const { initAnalytics, setAnalyticsEnabled } = await import("@/lib/product-insights");

    initAnalytics();
    setAnalyticsEnabled(false);
    for (const task of idleTasks) task();
    idleTasks = [];
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(init).not.toHaveBeenCalled();

    // `started` is still latched from the first attempt, so re-enabling has
    // to clear it or analytics stays off for the rest of the page.
    setAnalyticsEnabled(true);
    await flushIdle();

    expect(init).toHaveBeenCalledTimes(1);
  });
});
