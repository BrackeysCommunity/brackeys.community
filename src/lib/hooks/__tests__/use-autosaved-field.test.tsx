// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useAutosavedField } from "../use-autosaved-field";

/**
 * The write budget is the whole point of this hook, so these assert how
 * many times it wrote, not just what it ended up with.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function type(field: { onChange: (v: string) => void }, text: string) {
  for (let i = 1; i <= text.length; i++) {
    act(() => field.onChange(text.slice(0, i)));
  }
}

describe("useAutosavedField", () => {
  it("writes once on blur, never per keystroke", () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useAutosavedField("", commit));

    type(result.current, "salty");
    expect(commit).not.toHaveBeenCalled();

    act(() => result.current.onBlur());
    expect(commit).toHaveBeenCalledExactlyOnceWith("salty");
  });

  it("skips the write when the value still matches the server copy", () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useAutosavedField("lisbon", commit));

    act(() => result.current.onBlur());
    act(() => result.current.onChange("lisbo"));
    act(() => result.current.onChange("lisbon"));
    act(() => result.current.onBlur());

    expect(commit).not.toHaveBeenCalled();
  });

  it("writes only once for a value that blurs twice", () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useAutosavedField("", commit));

    type(result.current, "hi there");
    act(() => result.current.onBlur());
    act(() => result.current.onBlur());

    expect(commit).toHaveBeenCalledOnce();
  });

  it("backstops a long edit that never blurs", () => {
    const commit = vi.fn();
    const { result } = renderHook(() => useAutosavedField("", commit));

    type(result.current, "a long bio");
    act(() => vi.advanceTimersByTime(3000));

    expect(commit).toHaveBeenCalledExactlyOnceWith("a long bio");

    // And the backstopped value counts as saved — a blur after it is a no-op.
    act(() => result.current.onBlur());
    expect(commit).toHaveBeenCalledOnce();
  });

  it("flushes an unfinished edit when the field unmounts", () => {
    const commit = vi.fn();
    const { result, unmount } = renderHook(() => useAutosavedField("", commit));

    type(result.current, "half a bio");
    unmount();

    expect(commit).toHaveBeenCalledExactlyOnceWith("half a bio");
  });

  it("retries on the next blur when the write failed", async () => {
    const commit = vi.fn().mockRejectedValueOnce(new Error("429")).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useAutosavedField("", commit));

    type(result.current, "bio");
    act(() => result.current.onBlur());
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    act(() => result.current.onBlur());
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenLastCalledWith("bio");
  });
});
