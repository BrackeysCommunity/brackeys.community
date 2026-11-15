import { readFileSync } from "node:fs";
import { join } from "node:path";

// @vitest-environment jsdom
import { Store } from "@tanstack/store";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { sceneToDoc, sequentialKeys } from "../../collab/index";
import { createEditorSession, defineEditorTool, type SceneDefinition } from "../../editor/index";
import { createRegistry } from "../../game/index";
import { EditorFrame } from "../frame/EditorFrame";
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
    <EditorFrame status={<EditorStatusBar session={session} host={host} notice={notice} />}>
      <canvas />
    </EditorFrame>,
  );
  return session;
}

const status = () =>
  screen.getAllByRole("status").find((s) => s.classList.contains("je-status-start"))!;

afterEach(cleanup);

describe("a scene notice in the status bar", () => {
  it("shows beside the save state, not only for screen readers", async () => {
    resizeWindow(1280);
    const notice = new Store<SceneNotice | null>(null);
    setup(notice);
    act(() => notice.setState(() => ({ text: "Undid Move pad in Cellar" })));
    const shown = await within(status()).findByText("Undid Move pad in Cellar");
    expect(shown.className).toBe("je-status-notice");
    expect(shown.closest(".je-sr-only")).toBeNull();
  });
});

describe("a tool's refusal in the status bar", () => {
  it("shows in the status bar's warning tone", async () => {
    resizeWindow(1280);
    const session = setup(new Store<SceneNotice | null>(null));
    act(() => session.store.setState((s) => ({ ...s, notice: "Select a tilemap to paint." })));
    const shown = await within(status()).findByText("Select a tilemap to paint.");
    expect(shown.getAttribute("data-tone")).toBe("warning");
    expect(shown.closest(".je-status")).not.toBeNull();
    const css = readFileSync(join(import.meta.dirname, "../style.css"), "utf8");
    expect(css).toMatch(/\.je-status \[data-tone="warning"\] \{\s*color: var\(--je-warning\);/);
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
