import { readFileSync } from "node:fs";
import { join } from "node:path";

// @vitest-environment jsdom
import { Store } from "@tanstack/store";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys } from "../../collab/index";
import { createEditorSession, type SceneDefinition } from "../../editor/index";
import { createRegistry } from "../../game/index";
import { EditorFrame, editorChrome, Island } from "../frame/EditorFrame";
import type { EditorHostState } from "../session/live-scene-editor";
import { fakeWorldGame } from "./fake-world-game";

// jsdom has no WebGL, so the Pixi application is a stand-in; the containers are real.
vi.mock("pixi.js", async (importOriginal) => {
  const pixi = await importOriginal<typeof import("pixi.js")>();
  class Application {
    stage = new pixi.Container();
    renderer = { resize: () => {} };
    async init() {}
    destroy() {}
  }
  return {
    ...pixi,
    Application,
    Assets: { load: async () => pixi.Texture.WHITE, unload: async () => {} },
  };
});

const notify = Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() });

afterEach(cleanup);

const f6 = (shift = false) => fireEvent.keyDown(window, { key: "F6", shiftKey: shift });
const focused = () => document.activeElement?.getAttribute("data-stop") ?? null;

/** A frame whose every slot holds one island with a named button. */
function slots() {
  const stop = (name: string) => (
    <Island>
      <button type="button" data-stop={name}>
        {name}
      </button>
    </Island>
  );
  render(
    <EditorFrame
      topLeft={
        // The host's own island, which the corner already makes a stop.
        <div data-je-region="">
          <button type="button" data-stop="site">
            site
          </button>
        </div>
      }
      topRight={
        <button type="button" data-stop="top-right">
          top-right
        </button>
      }
      context={stop("context")}
      left={stop("left")}
      right={
        <>
          {stop("right-1")}
          {stop("right-2")}
        </>
      }
      dock={stop("dock")}
      status={stop("status")}
    >
      <canvas data-stop="canvas" />
    </EditorFrame>,
  );
}

describe("the frame's regions", () => {
  it("cycles F6 through the host's chrome, the columns, the dock, the status and the canvas", () => {
    slots();
    const order = [
      "site",
      "top-right",
      "context",
      "left",
      "right-1",
      "right-2",
      "dock",
      "status",
    ] as const;
    for (const name of order) {
      f6();
      expect(focused()).toBe(name);
    }
    f6();
    expect(document.activeElement?.hasAttribute("data-je-document")).toBe(true);
    f6();
    expect(focused()).toBe("site");
  });

  it("goes back with Shift+F6, and ignores F6 with a modifier", () => {
    slots();
    f6();
    f6(true);
    expect(document.activeElement?.hasAttribute("data-je-document")).toBe(true);
    f6(true);
    expect(focused()).toBe("status");
    fireEvent.keyDown(window, { key: "F6", ctrlKey: true });
    expect(focused()).toBe("status");
  });

  it("carries .je-root on the frame and on the kit's portal container", () => {
    const { container } = render(
      <EditorFrame theme="light">
        <canvas />
      </EditorFrame>,
    );
    const frame = container.querySelector(".je-frame");
    expect(frame?.classList.contains("je-root")).toBe(true);
    expect(frame?.getAttribute("data-je-theme")).toBe("light");
    const portal = container.querySelector(".je-portal");
    expect(portal?.classList.contains("je-root")).toBe(true);
    expect(portal?.getAttribute("data-je-theme")).toBe("light");
  });

  it("marks only the host's chrome slots .je-host, which the editor's resets skip", () => {
    slots();
    const hosts = [...document.querySelectorAll(".je-host")].map((el) => el.className);
    expect(hosts).toEqual(["je-frame-top-left je-host", "je-frame-top-right je-host"]);
    expect(screen.getByText("context").closest(".je-host")).toBeNull();
  });

  it("keeps every descendant reset in the stylesheet off .je-host", () => {
    const styleCss = readFileSync(join(import.meta.dirname, "../style.css"), "utf8");
    const resets = styleCss.slice(
      styleCss.indexOf("@layer jams-editor"),
      styleCss.indexOf("/* ─── Kit"),
    );
    const selectors = [...resets.matchAll(/^\s*(\.je-root [^{]+)\{/gm)].flatMap((m) =>
      m[1]!.split(/,\n/).map((s) => s.trim()),
    );
    expect(selectors.length).toBeGreaterThan(8);
    for (const selector of selectors) expect(selector).toMatch(/:where\(:not\(\.je-host/);
  });
});

describe("the editor's chrome in the frame", () => {
  const scene: SceneDefinition = {
    v: 1,
    name: "frame-yard",
    bounds: [0, 0, 2000, 1200],
    entities: [{ id: "pad", type: "marker", at: [100, 100] }],
  };

  function editor() {
    const registry = createRegistry();
    const session = createEditorSession({
      doc: sceneToDoc(scene, { key: sequentialKeys("t") }),
      origin: { kind: "user", userId: "ada", name: "Ada" },
      name: "frame-yard",
      registry,
      issuesDebounceMs: 0,
    });
    const host = new Store<EditorHostState>({ connection: "live", sceneChanged: false });
    const { game } = fakeWorldGame(registry);
    render(
      <EditorFrame
        topLeft={
          <button type="button" data-stop="site">
            site
          </button>
        }
        {...editorChrome({
          session,
          host,
          game,
          notify,
          onPlay: vi.fn(),
          onReplay: vi.fn(),
          onStop: vi.fn(),
          onRestart: vi.fn(),
        })}
      >
        <canvas />
      </EditorFrame>,
    );
    return session;
  }

  const regions = () =>
    [...document.querySelectorAll<HTMLElement>("[data-je-region]")].map((r) =>
      r.hasAttribute("data-je-document")
        ? "canvas"
        : r.closest(".je-frame-top-left")
          ? "host"
          : r.closest(".je-frame-dock")
            ? "dock"
            : r.closest(".je-frame-left")
              ? "left"
              : r.closest(".je-frame-right")
                ? "right"
                : r.closest(".je-frame-status")
                  ? "status"
                  : "other",
    );

  it("draws the columns, the dock and the status in edit mode", () => {
    editor();
    expect(screen.getByRole("navigation", { name: "Outliner" })).toBeTruthy();
    expect(screen.getByRole("toolbar", { name: "Editor" })).toBeTruthy();
    expect(new Set(regions())).toEqual(
      new Set(["host", "left", "right", "dock", "status", "canvas"]),
    );
  });

  it("leaves only the dock and the host's chrome in play mode", () => {
    const session = editor();
    act(() => session.setMode("play"));
    expect(screen.queryByRole("navigation", { name: "Outliner" })).toBeNull();
    expect(screen.queryByRole("toolbar", { name: "Editor" })).toBeNull();
    expect(screen.getByRole("toolbar", { name: "Play controls" })).toBeTruthy();
    expect(new Set(regions())).toEqual(new Set(["host", "dock", "canvas"]));

    f6();
    expect(focused()).toBe("site");
    f6();
    expect(
      screen.getByRole("toolbar", { name: "Play controls" }).contains(document.activeElement),
    ).toBe(true);
    f6();
    expect(document.activeElement?.hasAttribute("data-je-document")).toBe(true);
  });
});
