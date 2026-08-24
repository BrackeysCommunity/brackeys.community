// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("posthog-js", () => ({
  default: { init: vi.fn(), set_config: vi.fn(), register: vi.fn() },
}));

const {
  analyticsOptedOut,
  analyticsPreference,
  analyticsPreferenceServerSnapshot,
  globalPrivacyControlEnabled,
  setAnalyticsEnabled,
  subscribeAnalyticsPreference,
} = await import("@/lib/product-insights");

const OPT_OUT_KEY = "brackeys-analytics";

/** GPC is not in lib.dom, and jsdom does not implement it. */
function setGpc(value: boolean | undefined) {
  if (value === undefined) {
    Reflect.deleteProperty(navigator, "globalPrivacyControl");
    return;
  }
  Object.defineProperty(navigator, "globalPrivacyControl", { value, configurable: true });
}

beforeEach(() => localStorage.clear());

afterEach(() => {
  setGpc(undefined);
  localStorage.clear();
});

describe("globalPrivacyControlEnabled", () => {
  it("reads the browser signal, and only the exact boolean", () => {
    setGpc(undefined);
    expect(globalPrivacyControlEnabled()).toBe(false);

    setGpc(true);
    expect(globalPrivacyControlEnabled()).toBe(true);

    setGpc(false);
    expect(globalPrivacyControlEnabled()).toBe(false);
  });
});

describe("analyticsOptedOut", () => {
  it("defaults to opted in when nothing is stored and no signal is sent", () => {
    expect(analyticsOptedOut()).toBe(false);
  });

  it("treats a Global Privacy Control signal as an opt-out", () => {
    setGpc(true);
    expect(analyticsOptedOut()).toBe(true);
  });

  it("lets an explicit opt-in override the signal", () => {
    setGpc(true);
    setAnalyticsEnabled(true);

    expect(localStorage.getItem(OPT_OUT_KEY)).toBe("on");
    expect(analyticsOptedOut()).toBe(false);
  });

  it("lets an explicit opt-out stand without any signal", () => {
    setAnalyticsEnabled(false);

    expect(localStorage.getItem(OPT_OUT_KEY)).toBe("off");
    expect(analyticsOptedOut()).toBe(true);
  });

  // Before GPC the key was written only on opt-out and removed on opt-in, so
  // browsers in the wild carry a bare "off" and nothing else.
  it("still honours an opt-out stored by the previous scheme", () => {
    localStorage.setItem(OPT_OUT_KEY, "off");
    expect(analyticsOptedOut()).toBe(true);
  });

  it("ignores an unrecognised stored value and falls back to the signal", () => {
    localStorage.setItem(OPT_OUT_KEY, "maybe");
    expect(analyticsOptedOut()).toBe(false);

    setGpc(true);
    expect(analyticsOptedOut()).toBe(true);
  });
});

describe("analyticsPreference", () => {
  it("separates a signalled opt-out from a chosen one", () => {
    setGpc(true);
    expect(analyticsPreference()).toBe("off-gpc");

    setAnalyticsEnabled(false);
    expect(analyticsPreference()).toBe("off");
  });

  it("reports plain on when nothing is opting the visitor out", () => {
    expect(analyticsPreference()).toBe("on");

    setAnalyticsEnabled(true);
    expect(analyticsPreference()).toBe("on");
  });

  // Hydration starts from this value, so a change here is a change to what
  // every visitor's switch shows before the client takes over.
  it("assumes opted in on the server, where neither source is readable", () => {
    setGpc(true);
    setAnalyticsEnabled(false);

    expect(analyticsPreferenceServerSnapshot()).toBe("on");
  });
});

describe("subscribeAnalyticsPreference", () => {
  it("notifies on a change made in this tab, until unsubscribed", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAnalyticsPreference(listener);

    setAnalyticsEnabled(false);
    expect(listener).toHaveBeenCalledTimes(1);

    setAnalyticsEnabled(true);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    setAnalyticsEnabled(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("notifies on a change made in another tab", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAnalyticsPreference(listener);

    window.dispatchEvent(new StorageEvent("storage", { key: OPT_OUT_KEY, newValue: "off" }));
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    window.dispatchEvent(new StorageEvent("storage", { key: OPT_OUT_KEY, newValue: "on" }));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
