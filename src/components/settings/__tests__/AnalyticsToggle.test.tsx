import { cleanup, fireEvent, render, screen } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("posthog-js", () => ({
  default: { init: vi.fn(), set_config: vi.fn(), register: vi.fn() },
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: null }) },
  signInWithDiscord: vi.fn(),
}));

const { PrivacySection } = await import("@/components/settings/PrivacySection");

const OPT_OUT_KEY = "brackeys-analytics";

function setGpc(value: boolean | undefined) {
  if (value === undefined) {
    Reflect.deleteProperty(navigator, "globalPrivacyControl");
    return;
  }
  Object.defineProperty(navigator, "globalPrivacyControl", { value, configurable: true });
}

const toggle = () => screen.getByRole("switch", { name: /anonymous usage analytics/i });
const isChecked = () => toggle().getAttribute("aria-checked") === "true";
const explainsGpc = () => screen.queryByText(/Global Privacy Control/) !== null;

beforeEach(() => localStorage.clear());

afterEach(() => {
  cleanup();
  setGpc(undefined);
  localStorage.clear();
});

describe("the analytics toggle", () => {
  it("reads as on by default", () => {
    render(<PrivacySection />);

    expect(isChecked()).toBe(true);
  });

  it("reads as off, and says why, when the browser sends Global Privacy Control", () => {
    setGpc(true);
    render(<PrivacySection />);

    expect(isChecked()).toBe(false);
    expect(explainsGpc()).toBe(true);
  });

  it("overrides the signal when switched on, and stops explaining it", () => {
    setGpc(true);
    render(<PrivacySection />);
    fireEvent.click(toggle());

    expect(isChecked()).toBe(true);
    expect(localStorage.getItem(OPT_OUT_KEY)).toBe("on");
    expect(explainsGpc()).toBe(false);
  });

  it("reads as off without naming the signal when the visitor chose it", () => {
    localStorage.setItem(OPT_OUT_KEY, "off");
    render(<PrivacySection />);

    expect(isChecked()).toBe(false);
    expect(explainsGpc()).toBe(false);
  });

  // The switch subscribes rather than holding its own copy, so a change made
  // in another tab has to reach it.
  it("follows a change made in another tab", () => {
    render(<PrivacySection />);
    expect(isChecked()).toBe(true);

    localStorage.setItem(OPT_OUT_KEY, "off");
    fireEvent(window, new StorageEvent("storage", { key: OPT_OUT_KEY, newValue: "off" }));

    expect(isChecked()).toBe(false);
  });
});
