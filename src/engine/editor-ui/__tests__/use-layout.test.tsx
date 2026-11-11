// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { EditorStorage } from "../host";
import { DEFAULT_LAYOUT, resizeColumn, selectTab, type EditorLayout } from "../layout/model";
import { LAYOUT_KEY, LAYOUT_WRITE_DELAY, useLayout } from "../layout/use-layout";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: vi.fn((key: string) => data.get(key) ?? null),
    set: vi.fn((key: string, value: string) => void data.set(key, value)),
  };
}

const throwing: EditorStorage = {
  get: () => {
    throw new Error("blocked");
  },
  set: () => {
    throw new Error("blocked");
  },
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useLayout", () => {
  it("reads the stored layout once", () => {
    const stored = resizeColumn(DEFAULT_LAYOUT, "right", 420);
    const storage = memoryStorage({ [LAYOUT_KEY]: JSON.stringify(stored) });
    const { result, rerender } = renderHook(() => useLayout(storage));
    rerender();
    act(() => result.current.update((l) => selectTab(l, "run")));
    expect(storage.get).toHaveBeenCalledTimes(1);
    expect(storage.get).toHaveBeenCalledWith("jams-editor:layout:v1");
    expect(result.current.layout.right.width).toBe(420);
  });

  it("falls back to the default for a bad or old value", () => {
    const old = memoryStorage({ [LAYOUT_KEY]: JSON.stringify({ ...DEFAULT_LAYOUT, v: 0 }) });
    expect(renderHook(() => useLayout(old)).result.current.layout).toEqual(DEFAULT_LAYOUT);
    const bad = memoryStorage({ [LAYOUT_KEY]: "{" });
    expect(renderHook(() => useLayout(bad)).result.current.layout).toEqual(DEFAULT_LAYOUT);
  });

  it("writes once, after the changes settle", () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useLayout(storage));
    expect(storage.set).not.toHaveBeenCalled();

    act(() => result.current.update((l) => resizeColumn(l, "left", 300)));
    act(() => vi.advanceTimersByTime(LAYOUT_WRITE_DELAY - 50));
    act(() => result.current.update((l) => resizeColumn(l, "left", 340)));
    act(() => vi.advanceTimersByTime(LAYOUT_WRITE_DELAY - 1));
    expect(storage.set).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(storage.set).toHaveBeenCalledTimes(1);
    const written = JSON.parse(storage.data.get(LAYOUT_KEY)!) as EditorLayout;
    expect(written.left.width).toBe(340);

    act(() => vi.advanceTimersByTime(LAYOUT_WRITE_DELAY * 4));
    expect(storage.set).toHaveBeenCalledTimes(1);
  });

  it("writes nothing for an edit that changes nothing", () => {
    const storage = memoryStorage();
    const { result } = renderHook(() => useLayout(storage));
    act(() => result.current.update((l) => resizeColumn(l, "left", 288)));
    act(() => vi.advanceTimersByTime(LAYOUT_WRITE_DELAY * 2));
    expect(storage.set).not.toHaveBeenCalled();
  });

  it("stores a change still settling when the editor unmounts", () => {
    const storage = memoryStorage();
    const { result, unmount } = renderHook(() => useLayout(storage));
    act(() => result.current.update((l) => resizeColumn(l, "right", 400)));
    unmount();
    expect(storage.set).toHaveBeenCalledTimes(1);
    expect((JSON.parse(storage.data.get(LAYOUT_KEY)!) as EditorLayout).right.width).toBe(400);
  });

  it("resets to the default layout and stores it", () => {
    const storage = memoryStorage({
      [LAYOUT_KEY]: JSON.stringify(resizeColumn(DEFAULT_LAYOUT, "left", 400)),
    });
    const { result } = renderHook(() => useLayout(storage));
    act(() => result.current.reset());
    expect(result.current.layout).toEqual(DEFAULT_LAYOUT);
    act(() => vi.advanceTimersByTime(LAYOUT_WRITE_DELAY));
    expect(JSON.parse(storage.data.get(LAYOUT_KEY)!)).toEqual(DEFAULT_LAYOUT);
  });

  for (const [name, storage] of [
    ["a throwing storage", throwing],
    ["a null storage", null],
  ] as const) {
    it(`renders the default with ${name} and keeps changes for the page`, () => {
      const { result, unmount } = renderHook(() => useLayout(storage));
      expect(result.current.layout).toEqual(DEFAULT_LAYOUT);
      act(() => result.current.update((l) => resizeColumn(l, "left", 360)));
      act(() => vi.advanceTimersByTime(LAYOUT_WRITE_DELAY * 2));
      expect(result.current.layout.left.width).toBe(360);
      act(() => result.current.update((l) => selectTab(l, "history")));
      expect(result.current.layout.right.groups[1]!.active).toBe("history");
      expect(result.current.layout.left.width).toBe(360);
      expect(() => unmount()).not.toThrow();
    });
  }

  it("hydrates a server render with the default, then takes the stored layout", () => {
    const stored = resizeColumn(DEFAULT_LAYOUT, "right", 420);
    const storage = memoryStorage({ [LAYOUT_KEY]: JSON.stringify(stored) });
    function Width() {
      return <output>{useLayout(storage).layout.right.width}</output>;
    }
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Width />);
    expect(container.textContent).toBe(String(DEFAULT_LAYOUT.right.width));
    expect(storage.get).not.toHaveBeenCalled();

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let root: ReturnType<typeof hydrateRoot> | undefined;
      act(() => {
        root = hydrateRoot(container, <Width />);
      });
      expect(container.textContent).toBe("420");
      act(() => vi.advanceTimersByTime(LAYOUT_WRITE_DELAY * 2));
      expect(storage.set).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      act(() => root?.unmount());
    } finally {
      error.mockRestore();
    }
  });
});
