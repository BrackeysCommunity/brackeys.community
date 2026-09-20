// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { useHideOnScrollDown } from "../use-hide-on-scroll-down";

// Past the default pin distance, so the bar is allowed to react at all.
const DEEP = 1200;

function mountScroller() {
  const el = document.createElement("div");
  el.setAttribute("data-scroll-root", "");
  document.body.append(el);
  return el;
}

/** Move the scroller the way a user does: position first, then the event. */
function scrollTo(el: HTMLElement, top: number) {
  act(() => {
    el.scrollTop = top;
    el.dispatchEvent(new Event("scroll"));
  });
}

/** Move it the way the router does — straight to a position, no event. */
function jumpTo(el: HTMLElement, top: number) {
  act(() => {
    el.scrollTop = top;
  });
}

/** Let the hook's post-navigation measurement run. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useHideOnScrollDown", () => {
  it("hides on the way down and comes back on the way up", async () => {
    const el = mountScroller();
    const { result } = renderHook(() => useHideOnScrollDown("/members"));
    await settle();

    scrollTo(el, 400);
    scrollTo(el, DEEP);
    expect(result.current).toBe(true);

    scrollTo(el, DEEP - 200);
    expect(result.current).toBe(false);
  });

  it("stays out when the router restores a deep offset", async () => {
    const el = mountScroller();
    const { result, rerender } = renderHook(({ path }) => useHideOnScrollDown(path), {
      initialProps: { path: "/members" },
    });
    await settle();

    scrollTo(el, DEEP);
    expect(result.current).toBe(true);

    // Leaving and coming back: the restored offset arrives as one jump, which
    // is not the user scrolling down and must not be read as one.
    rerender({ path: "/profile/1" });
    rerender({ path: "/members" });
    scrollTo(el, DEEP);
    expect(result.current).toBe(false);
  });

  it("comes back when a navigation swaps the scroller for one at the top", async () => {
    const first = mountScroller();
    const { result, rerender } = renderHook(({ path }) => useHideOnScrollDown(path), {
      initialProps: { path: "/members" },
    });
    await settle();

    scrollTo(first, 400);
    scrollTo(first, DEEP);
    expect(result.current).toBe(true);

    // The shell mounts a different scroller for the incoming page. It starts
    // at the top and fires nothing, so only a measurement can notice.
    first.remove();
    const second = mountScroller();
    rerender({ path: "/jams" });
    await settle();

    expect(second.scrollTop).toBe(0);
    expect(result.current).toBe(false);
  });

  it("comes back on a back/forward that keeps the same path", async () => {
    const el = mountScroller();
    const { result } = renderHook(() => useHideOnScrollDown("/members"));
    await settle();

    scrollTo(el, 400);
    scrollTo(el, DEEP);
    expect(result.current).toBe(true);

    // Search-param history entries: the path never changes, so the hook is
    // never re-armed and the restored position arrives silently.
    jumpTo(el, 0);
    act(() => {
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await settle();

    expect(result.current).toBe(false);
  });
});
