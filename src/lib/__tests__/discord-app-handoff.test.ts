// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

/**
 * The desktop handoff has to assume nothing about the desktop. A Linux
 * browser installed as a Flatpak or Snap cannot reach the host's
 * `discord://` handler, so the page's only signal — focus leaving and
 * coming back — describes an error dialog and a successful handoff
 * identically. Reading a blur as success retired the "Use browser"
 * fallback at the exact moment it was the only way into the site.
 */

type ToastOptions = { action?: { label: string; onClick: () => void } };

const toast = Object.assign(
  vi.fn<(message: string, options?: ToastOptions) => string>(() => "t1"),
  { success: vi.fn() },
);
vi.mock("@/lib/toast", () => ({ toast }));

const AUTHORIZE = "https://discord.com/oauth2/authorize?client_id=1&state=abc&prompt=none";
const APP_URL = "discord://-/oauth2/authorize?client_id=1&state=abc&prompt=none";

/** The options of the most recent `toast(...)` call. */
const lastToast = (): ToastOptions => toast.mock.calls.at(-1)?.[1] ?? {};

const assign = vi.fn();

// jsdom's `location` is unforgeable down to the method, so the whole object
// is swapped for the duration.
beforeEach(() => {
  vi.stubGlobal("location", { assign, href: "https://x.test/jams" });
  for (const fn of [toast, toast.success, assign]) fn.mockClear();
  localStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe("openDiscordAuthorize", () => {
  it("hands the deep link to the desktop client", async () => {
    const { openDiscordAuthorize } = await import("@/lib/discord-app-login");
    openDiscordAuthorize(AUTHORIZE);
    expect(assign).toHaveBeenCalledWith(APP_URL);
  });

  it("keeps the browser fallback through a blur that was really a failure", async () => {
    const { openDiscordAuthorize } = await import("@/lib/discord-app-login");
    openDiscordAuthorize(AUTHORIZE);

    window.dispatchEvent(new Event("blur"));
    expect(lastToast().action).toBeDefined();
    window.dispatchEvent(new Event("focus"));
    expect(lastToast().action).toBeDefined();

    lastToast().action?.onClick();
    expect(assign).toHaveBeenLastCalledWith(AUTHORIZE);
    expect(localStorage.getItem("discord-signin-route")).toBe("web");
  });

  it("retires the fallback once a sign-in lands, and stops following focus", async () => {
    const { openDiscordAuthorize } = await import("@/lib/discord-app-login");
    openDiscordAuthorize(AUTHORIZE);
    window.dispatchEvent(new StorageEvent("storage", { key: "discord-app-signin", newValue: "1" }));
    expect(toast.success).toHaveBeenCalledWith("Signed in", expect.objectContaining({ id: "t1" }));

    const calls = toast.mock.calls.length;
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    expect(toast.mock.calls.length).toBe(calls);
  });

  it("goes straight to the browser when the URL is not a Discord authorize URL", async () => {
    const { openDiscordAuthorize } = await import("@/lib/discord-app-login");
    const github = "https://github.com/login/oauth/authorize?client_id=1";
    openDiscordAuthorize(github);
    expect(assign).toHaveBeenCalledWith(github);
    expect(toast).not.toHaveBeenCalled();
  });
});
