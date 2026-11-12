import { Store } from "@tanstack/store";
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { CodeSkewNotice } from "../panels/CodeSkewNotice";
import type { EditorHostState } from "../session/live-scene-editor";

const skewed = (): Store<EditorHostState> =>
  new Store<EditorHostState>({
    connection: "live",
    sceneChanged: false,
    readOnly: {
      code: "code-skew",
      detail: { kind: "scene", mine: "a", project: "b" },
    } as unknown as EditorHostState["readOnly"],
  });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CodeSkewNotice", () => {
  it("shows nothing while the doc is editable", () => {
    const host = new Store<EditorHostState>({ connection: "live", sceneChanged: false });
    const { container } = render(<CodeSkewNotice host={host} />);
    expect(container.textContent).toBe("");
  });

  it("calls the given reload", () => {
    const onReload = vi.fn();
    render(<CodeSkewNotice host={skewed()} onReload={onReload} />);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(onReload).toHaveBeenCalledOnce();
  });

  it("reloads through globalThis.location by default, and is a no-op without one", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { reload });
    render(<CodeSkewNotice host={skewed()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledOnce();
    vi.stubGlobal("location", undefined);
    expect(() => fireEvent.click(screen.getByRole("button", { name: "Reload" }))).not.toThrow();
  });
});
