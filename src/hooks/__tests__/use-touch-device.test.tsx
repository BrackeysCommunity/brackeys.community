// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useIsTouchDevice } from "../use-touch-device";

interface FakeMql {
  matches: boolean;
  addEventListener: (type: "change", listener: (e: MediaQueryListEvent) => void) => void;
  removeEventListener: (type: "change", listener: (e: MediaQueryListEvent) => void) => void;
  // Test hook to flip and broadcast a change.
  fire: (next: boolean) => void;
}

let mql: FakeMql;
let originalMatchMedia: typeof window.matchMedia;

function makeFakeMql(initial: boolean): FakeMql {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const obj: FakeMql = {
    matches: initial,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    fire(next: boolean) {
      obj.matches = next;
      const evt = { matches: next } as unknown as MediaQueryListEvent;
      for (const l of listeners) l(evt);
    },
  };
  return obj;
}

beforeEach(() => {
  originalMatchMedia = window.matchMedia;
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.restoreAllMocks();
});

describe("useIsTouchDevice", () => {
  it("matches `(pointer: coarse)` on the current snapshot", () => {
    mql = makeFakeMql(true);
    window.matchMedia = vi.fn((q: string) => {
      expect(q).toBe("(pointer: coarse)");
      return mql as unknown as MediaQueryList;
    });

    const { result } = renderHook(() => useIsTouchDevice());
    expect(result.current).toBe(true);
  });

  it("returns false when pointer is fine", () => {
    mql = makeFakeMql(false);
    window.matchMedia = vi.fn(() => mql as unknown as MediaQueryList);

    const { result } = renderHook(() => useIsTouchDevice());
    expect(result.current).toBe(false);
  });

  it("re-renders when the media query flips at runtime", () => {
    mql = makeFakeMql(false);
    window.matchMedia = vi.fn(() => mql as unknown as MediaQueryList);

    const { result } = renderHook(() => useIsTouchDevice());
    expect(result.current).toBe(false);

    act(() => mql.fire(true));
    expect(result.current).toBe(true);

    act(() => mql.fire(false));
    expect(result.current).toBe(false);
  });
});
