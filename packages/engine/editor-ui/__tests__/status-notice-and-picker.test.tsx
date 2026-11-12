// @vitest-environment jsdom
import { Store } from "@tanstack/store";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { sceneToDoc, sequentialKeys } from "../../collab/index";
import { createEditorSession, defineEditorTool, type SceneDefinition } from "../../editor/index";
import { createRegistry } from "../../game/index";
import { EditorFrame, Island, useBottomRow } from "../frame/EditorFrame";
import { EditorStatusBar } from "../panels/EditorStatusBar";
import { dockParts, dockWidth, fitDock } from "../panels/EditorToolbar";
import type { EditorHostState } from "../session/live-scene-editor";
import type { SceneNotice } from "../session/use-scene-editor";

const scene: SceneDefinition = {
  v: 1,
  name: "notice-yard",
  bounds: [0, 0, 2000, 1200],
  entities: [],
};

function resizeWindow(width: number, height = 800) {
  act(() => {
    Object.assign(window, { innerWidth: width, innerHeight: height });
    window.dispatchEvent(new Event("resize"));
  });
}

/** A toolbar as wide as a full one at 1280: it leaves the status a short row. */
function WideDock() {
  useBottomRow("dock", { full: 900, least: 400 });
  return <div />;
}

function setup(notice: Store<SceneNotice | null>) {
  const session = createEditorSession({
    doc: sceneToDoc(scene, { key: sequentialKeys("t") }),
    origin: { kind: "user", userId: "ada", name: "Ada" },
    name: "notice-yard",
    registry: createRegistry(),
    issuesDebounceMs: 0,
  });
  const host = new Store<EditorHostState>({ connection: "live", sceneChanged: false });
  render(
    <EditorFrame
      dock={
        <Island>
          <WideDock />
        </Island>
      }
      status={
        <Island>
          <EditorStatusBar session={session} host={host} notice={notice} />
        </Island>
      }
    >
      <canvas />
    </EditorFrame>,
  );
}

const status = () => screen.getAllByRole("status").find((s) => s.classList.contains("je-status"))!;

afterEach(cleanup);

describe("a scene notice in the status", () => {
  it("stays visible, not only for screen readers, when the bottom row is short", async () => {
    resizeWindow(1280);
    const notice = new Store<SceneNotice | null>(null);
    setup(notice);
    await waitFor(() => expect(status().hasAttribute("data-compact")).toBe(true));
    act(() => notice.setState(() => ({ text: "Undid Move pad in Cellar" })));
    const row = status();
    await waitFor(() => expect(row.hasAttribute("data-compact")).toBe(true));
    const shown = within(row).getByText("Undid Move pad in Cellar");
    expect(shown.className).toBe("je-status-notice");
    expect(shown.closest(".je-sr-only")).toBeNull();
  });

  it("is drawn the same way in the full row", async () => {
    resizeWindow(2400);
    const notice = new Store<SceneNotice | null>({ text: "Redid Add gate in Yard" });
    setup(notice);
    await waitFor(() => expect(status().hasAttribute("data-compact")).toBe(false));
    expect(within(status()).getByText("Redid Add gate in Yard").className).toBe("je-status-notice");
  });
});

describe("the scene picker in a short toolbar", () => {
  const tool = (id: string) =>
    defineEditorTool({ id, label: id, description: id, create: () => ({}) });
  const parts = dockParts(
    [...["select", "pan", "box", "circle", "pen"].map(tool), tool("springs")],
    16,
    { choices: [{ label: "platform" }, { label: "ladder" }] },
    100,
    "The Yard",
  );

  it("moves into More tools after the grid step and the tool's option", () => {
    const order: string[] = [];
    for (let room = dockWidth(parts, new Set()); room > 0; room -= 4) {
      for (const key of fitDock(parts, room)) if (!order.includes(key)) order.push(key);
    }
    const at = (key: string) => order.indexOf(key);
    expect(at("scene")).toBeGreaterThan(at("step"));
    expect(at("scene")).toBeGreaterThan(at("option"));
    expect(at("scene")).toBeLessThan(at("tool:box"));
  });
});
