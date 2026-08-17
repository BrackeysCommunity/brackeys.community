// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { playToast } = vi.hoisted(() => ({ playToast: vi.fn() }));
const { sonner } = vi.hoisted(() => {
  const base = vi.fn(() => "bare");
  return {
    sonner: Object.assign(base, {
      success: vi.fn(() => "success-id"),
      error: vi.fn(() => "error-id"),
      warning: vi.fn(() => "warning-id"),
      dismiss: vi.fn(() => "dismissed"),
    }),
  };
});

vi.mock("sonner", () => ({ toast: sonner }));
vi.mock("@/lib/sound", () => ({ playToast }));

const { toast } = await import("../toast");

describe("toast", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cues the toast and forwards the call untouched", () => {
    expect(toast.success("Saved", { duration: 1 })).toBe("success-id");
    expect(sonner.success).toHaveBeenCalledWith("Saved", { duration: 1 });
    expect(playToast).toHaveBeenCalledOnce();
  });

  it("cues every outcome the same — the words carry which one it was", () => {
    toast.error("Nope");
    toast.warning("Careful");

    expect(playToast).toHaveBeenCalledTimes(2);
  });

  // The drop-in half of the swap: anything the wrapper doesn't cue has to
  // still be there, or converting a file would quietly break it.
  it("passes the rest of sonner's surface through", () => {
    expect(toast("Hi")).toBe("bare");
    expect(toast.dismiss()).toBe("dismissed");
    expect(playToast).not.toHaveBeenCalled();
  });
});
