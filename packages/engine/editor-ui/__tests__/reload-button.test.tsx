// @vitest-environment jsdom
import { Store } from "@tanstack/store";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { HINT_DELAY_MS } from "../kit/hint";
import { CodeSkewNotice, ReloadButton } from "../panels/CodeSkewNotice";
import type { EditorHostState } from "../session/live-scene-editor";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const reloadButton = () => screen.getByRole("button", { name: "Reload" });

describe("ReloadButton", () => {
  it("draws the same control as the read-only banner's Reload", () => {
    const host = new Store<EditorHostState>({
      connection: "live",
      sceneChanged: false,
      readOnly: {
        code: "code-skew",
        detail: { kind: "scene", mine: "a", project: "b" },
      } as unknown as EditorHostState["readOnly"],
    });
    render(<CodeSkewNotice host={host} />);
    const banner = reloadButton();
    const look = (el: HTMLElement) => [el.dataset.size, el.dataset.variant, el.className];
    const expected = look(banner);
    cleanup();
    render(<ReloadButton tooltip="Ask again" />);
    expect(look(reloadButton())).toEqual(expected);
    expect(expected.slice(0, 2)).toEqual(["xs", "outline"]);
  });

  it("reloads through globalThis.location by default, and is a no-op without one", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    render(<ReloadButton tooltip="Ask again" />);
    fireEvent.click(reloadButton());
    expect(reload).toHaveBeenCalledOnce();
    vi.stubGlobal("location", undefined);
    expect(() => fireEvent.click(reloadButton())).not.toThrow();
  });

  it("calls the given reload and shows its tooltip", () => {
    const onReload = vi.fn();
    render(<ReloadButton tooltip="Ask the scene server again" onReload={onReload} />);
    vi.useFakeTimers();
    const button = reloadButton();
    act(() => {
      fireEvent.keyDown(document.body, { key: "Tab" });
      button.focus();
    });
    act(() => void vi.advanceTimersByTime(HINT_DELAY_MS + 50));
    expect(document.querySelector(".je-hint")?.textContent).toBe("Ask the scene server again");
    fireEvent.click(button);
    expect(onReload).toHaveBeenCalledOnce();
  });
});
