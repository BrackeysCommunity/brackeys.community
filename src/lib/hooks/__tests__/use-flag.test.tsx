import { type PostHog, PostHogProvider } from "@posthog/react";
import { act, cleanup, renderHook } from "@testing-library/react";
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vite-plus/test";

import { FEATURE_FLAGS } from "@/lib/flags";
import { useFlag } from "@/lib/hooks/use-flag";

type FlagListener = () => void;

/**
 * Minimal stand-in for the parts of the PostHog client the flag hooks touch,
 * so a test can hold a flag at "unresolved" — the state the fallback exists
 * for, and the one a live client passes through too fast to observe.
 */
function fakeClient(flags: Record<string, boolean> = {}) {
  const listeners = new Set<FlagListener>();
  return {
    client: {
      featureFlags: { hasLoadedFlags: false },
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

function renderFlag(client: unknown) {
  return renderHook(() => useFlag("flag-smoke-test"), {
    wrapper: ({ children }) => (
      <PostHogProvider client={client as PostHog}>{children}</PostHogProvider>
    ),
  });
}

afterEach(cleanup);

describe("useFlag", () => {
  it("serves the declared default until PostHog answers", () => {
    const { client } = fakeClient();
    const { result } = renderFlag(client);
    expect(result.current).toBe(FEATURE_FLAGS["flag-smoke-test"]);
  });

  it("re-renders with the real value once flags resolve", () => {
    const fake = fakeClient();
    const { result } = renderFlag(fake.client);

    act(() => {
      fake.client.featureFlags.hasLoadedFlags = true;
      fake.resolve({ "flag-smoke-test": true });
    });

    expect(result.current).toBe(true);
  });

  it("falls back rather than throwing against a client that was never initialised", async () => {
    // The shape of a deploy with no `VITE_POSTHOG_KEY`: the posthog-js
    // singleton exists and is mounted, but `init` never ran.
    const { default: posthog } = await import("posthog-js");
    const { result } = renderFlag(posthog);
    expect(result.current).toBe(FEATURE_FLAGS["flag-smoke-test"]);
  });
});
