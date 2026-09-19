import { ORPCError } from "@orpc/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// @vitest-environment jsdom

/**
 * `reportMutationError` drops a 4xx `ORPCError` by default — the contract
 * working — and the OAuth callbacks opt out of that, because there a 4xx
 * is the failure. This pins both halves and the tag that lets a dashboard
 * tell them apart.
 */

const captureException = vi.fn();

vi.mock("posthog-js", () => ({
  default: {
    init: vi.fn(),
    register: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    captureException,
    set_config: vi.fn(),
  },
}));

vi.mock("@/env", () => ({
  env: { VITE_POSTHOG_KEY: "phc_test", VITE_POSTHOG_HOST: undefined },
}));

vi.stubGlobal("__APP_VERSION__", "0.0.0-test");
vi.stubGlobal("requestIdleCallback", (fn: () => void) => {
  fn();
  return 0;
});

async function loadReporter() {
  const mod = await import("@/lib/product-insights");
  mod.initAnalytics();
  await vi.waitFor(() => expect(mod.getPostHogClientSnapshot()).not.toBeNull());
  return mod.reportMutationError;
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  captureException.mockClear();
});

afterEach(() => localStorage.clear());

describe("reportMutationError", () => {
  it("drops an expected 4xx by default", async () => {
    const report = await loadReporter();

    report(new ORPCError("BAD_REQUEST", { message: "nope" }), "comments.create");

    expect(captureException).not.toHaveBeenCalled();
  });

  it("reports a 5xx and a plain throw under the scope", async () => {
    const report = await loadReporter();

    report(new ORPCError("INTERNAL_SERVER_ERROR"), "comments.create");
    report(new TypeError("Failed to fetch"), "comments.create", { post_id: "p1" });

    expect(captureException).toHaveBeenCalledTimes(2);
    expect(captureException).toHaveBeenLastCalledWith(
      expect.any(TypeError),
      expect.objectContaining({ scope: "comments.create", post_id: "p1" }),
    );
  });

  it("reports an expected 4xx when the flow asks for it, tagged with the oRPC code", async () => {
    const report = await loadReporter();
    const err = new ORPCError("BAD_REQUEST", { message: "No GitHub account found." });

    report(err, "profile.link_github_callback", { provider: "github" }, { reportExpected: true });

    expect(captureException).toHaveBeenCalledWith(
      err,
      expect.objectContaining({
        scope: "profile.link_github_callback",
        provider: "github",
        orpc_code: "BAD_REQUEST",
        orpc_status: 400,
      }),
    );
  });
});
