// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { EditorNotify } from "../host";
import { createPending } from "../pending/pending";
import { PendingProvider, useBusy, useOwnOrSharedPending } from "../pending/use-pending";

afterEach(cleanup);

function fakeNotify() {
  const toasts = { success: vi.fn(), warning: vi.fn(), error: vi.fn() };
  const notify: EditorNotify = Object.assign(vi.fn(), toasts);
  return { notify, toasts };
}

describe("useOwnOrSharedPending", () => {
  it("returns the provider's Pending when there is one", () => {
    const shared = createPending(fakeNotify());
    const { result } = renderHook(() => useOwnOrSharedPending(fakeNotify().notify), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <PendingProvider pending={shared}>{children}</PendingProvider>
      ),
    });
    expect(result.current).toBe(shared);
  });

  it("keeps one Pending of its own across renders, reporting through the latest notify", async () => {
    const first = fakeNotify();
    const latest = fakeNotify();
    const { result, rerender } = renderHook(({ notify }) => useOwnOrSharedPending(notify), {
      initialProps: { notify: first.notify },
    });
    const own = result.current;
    rerender({ notify: latest.notify });
    expect(result.current).toBe(own);

    await act(() =>
      own.run({ label: "x", scope: "s", error: "Couldn't", success: "Done" }, async () => 1),
    );
    await act(() =>
      own.run({ label: "y", scope: "s", error: "Couldn't" }, () =>
        Promise.reject(new Error("nope")),
      ),
    );
    expect(first.toasts.error).not.toHaveBeenCalled();
    expect(first.toasts.success).not.toHaveBeenCalled();
    expect(latest.toasts.success).toHaveBeenCalledWith("Done", undefined);
    expect(latest.toasts.error).toHaveBeenCalledOnce();
  });

  it("shows its own tasks as busy once rendered under a PendingProvider", () => {
    const { result } = renderHook(() => {
      const pending = useOwnOrSharedPending(fakeNotify().notify);
      return pending;
    });
    const own = result.current;
    const busy = renderHook(() => useBusy("scope:a"), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <PendingProvider pending={own}>{children}</PendingProvider>
      ),
    });
    expect(busy.result.current).toBeUndefined();
    let release!: () => void;
    act(() => {
      void own.run({ label: "Working", scope: "scope:a", error: "Couldn't" }, () => {
        return new Promise<void>((done) => (release = done));
      });
    });
    expect(busy.result.current?.label).toBe("Working");
    act(() => release());
  });
});
