import { act, cleanup, renderHook } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { FEATURE_FLAGS } from "@/lib/flags";

type FlagListener = () => void;

/**
 * `@/lib/product-insights` is mocked rather than imported for real: `useFlag` reads
 * the client through its module-level store (`getPostHogClientSnapshot` /
 * `subscribePostHogClient`), not React context, so this is the seam a test
 * drives instead of a provider wrapper.
 */
vi.mock("@/lib/product-insights", () => {
  let client: unknown = null;
  const listeners = new Set<FlagListener>();
  return {
    getPostHogClientSnapshot: () => client,
    subscribePostHogClient: (cb: FlagListener) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    __setClient(next: unknown) {
      client = next;
      for (const cb of listeners) cb();
    },
  };
});

const posthogMock = await import("@/lib/product-insights");
const { useFlag } = await import("@/lib/hooks/use-flag");

function setClient(client: unknown) {
  (posthogMock as unknown as { __setClient: (c: unknown) => void }).__setClient(client);
}

/**
 * Minimal stand-in for the parts of the PostHog client `useFlag` touches, so
 * a test can hold a flag at "unresolved" — the state the fallback exists
 * for, and the one a live client passes through too fast to observe.
 */
function fakeClient(flags: Record<string, boolean> = {}) {
  const listeners = new Set<FlagListener>();
  return {
    client: {
      isFeatureEnabled: (flag: string) => flags[flag],
      onFeatureFlags: (cb: FlagListener) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    },
    resolve(next: Record<string, boolean>) {
      Object.assign(flags, next);
      for (const cb of listeners) cb();
    },
  };
}

afterEach(() => {
  cleanup();
  setClient(null);
});

describe("useFlag", () => {
  it("serves the declared default before the client has loaded", () => {
    const { result } = renderHook(() => useFlag("flag-smoke-test"));
    expect(result.current).toBe(FEATURE_FLAGS["flag-smoke-test"]);
  });

  it("serves the declared default until PostHog answers", () => {
    const { client } = fakeClient();
    setClient(client);

    const { result } = renderHook(() => useFlag("flag-smoke-test"));
    expect(result.current).toBe(FEATURE_FLAGS["flag-smoke-test"]);
  });

  it("re-renders with the real value once flags resolve", () => {
    const fake = fakeClient();
    setClient(fake.client);

    const { result } = renderHook(() => useFlag("flag-smoke-test"));
    act(() => fake.resolve({ "flag-smoke-test": true }));

    expect(result.current).toBe(true);
  });

  it("falls back rather than throwing against a client that was never initialised", async () => {
    // The shape of a deploy with no `VITE_POSTHOG_KEY`, or one still
    // mid-load: the real posthog-js singleton exists but `init` never ran,
    // so `isFeatureEnabled` answers `undefined` rather than a boolean.
    const { default: posthog } = await import("posthog-js");
    setClient(posthog);

    const { result } = renderHook(() => useFlag("flag-smoke-test"));
    expect(result.current).toBe(FEATURE_FLAGS["flag-smoke-test"]);
  });
});
