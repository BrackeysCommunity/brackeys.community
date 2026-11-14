// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import type { CSSProperties, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { toolRegistry } from "../../../../__tests__/fixtures/test-tool";
import { sceneToDoc, sequentialKeys } from "../../../../collab/index";
import { createEditorSession, createToolHost, DEFAULT_SNAP } from "../../../../editor/index";
import type { SceneDefinition } from "../../../../scene/index";
import { createToolRouter } from "../../../../tool-router";
import { useHostOverlay } from "../tool-host";
import { ToolOverlayLabels } from "../ToolOverlayLayer";
import type { View } from "../view";

const S = 100;
const view: View = { width: 1024, height: 768, scale: S, tx: 0, ty: 0 };

/** A floor far wider than the view, its top-right corner well past the right edge. */
const scene = (): SceneDefinition => ({
  v: 1,
  name: "wide",
  bounds: [0, -10, 40, 20],
  entities: [{ id: "floor", type: "solid", shape: ["box", 16, 5, 16, 0.5] }],
});

function rig() {
  const session = createEditorSession({
    doc: sceneToDoc(scene(), { key: sequentialKeys("k") }),
    origin: { kind: "user", userId: "ada", name: "Ada" },
    name: "wide",
    registry: toolRegistry,
    issuesDebounceMs: 0,
  });
  const host = createToolHost({
    session,
    router: createToolRouter(),
    toWorld: ({ x, y }) => [x / S, y / S],
    scale: () => S,
    snap: { ...DEFAULT_SNAP, enabled: false },
  });
  return { session, host };
}

const rigs: ReturnType<typeof rig>[] = [];
afterEach(() => {
  cleanup();
  for (const r of rigs.splice(0)) {
    r.host.destroy();
    r.session.destroy();
  }
  vi.useRealTimers();
});

function Labels({ host }: { host: ReturnType<typeof rig>["host"] }) {
  return <ToolOverlayLabels overlay={useHostOverlay(host)} view={view} />;
}

/** The frame's markup the labels read the chrome's insets from. */
function Frame({ right, children }: { right: number; children: ReactNode }) {
  return (
    <div className="je-frame">
      <div data-je-document="" style={{ "--jams-ui-safe-right": `${right}px` } as CSSProperties} />
      {children}
    </div>
  );
}

const tagAt = (): [number, number] => {
  const el = document.querySelector<HTMLElement>("[data-readout]");
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(el?.style.transform ?? "");
  if (!m) throw new Error(`no readout placed: ${el?.style.transform}`);
  return [Number(m[1]), Number(m[2])];
};

describe("a command's notice on the canvas", () => {
  it("stays inside the view when the selection's corner is off it", () => {
    const r = rig();
    rigs.push(r);
    render(<Labels host={r.host} />);
    act(() => r.session.select(["floor"]));
    act(() => void r.host.command("ungroup"));
    expect(r.host.overlay().readout?.at[0]).toBeGreaterThan(view.width / S);
    const [x, y] = tagAt();
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(view.width);
    expect(y).toBeGreaterThanOrEqual(0);
    expect(y).toBeLessThanOrEqual(view.height);
  });

  it("stays clear of the panels the frame lays over the canvas", () => {
    const r = rig();
    rigs.push(r);
    render(
      <Frame right={300}>
        <Labels host={r.host} />
      </Frame>,
    );
    act(() => r.session.select(["floor"]));
    act(() => void r.host.command("ungroup"));
    expect(tagAt()[0]).toBeLessThanOrEqual(view.width - 300);
  });

  it("is announced once it holds, and cleared with it", () => {
    vi.useFakeTimers();
    const r = rig();
    rigs.push(r);
    render(<Labels host={r.host} />);
    const status = () => document.querySelector('[role="status"][aria-live="polite"]');
    act(() => r.session.select(["floor"]));
    act(() => void r.host.command("ungroup"));
    expect(status()?.textContent).toBe("");
    act(() => void vi.advanceTimersByTime(400));
    expect(status()?.textContent).toBe("Select a node to ungroup.");
    act(() => void vi.advanceTimersByTime(3000));
    expect(document.querySelector("[data-readout]")).toBeNull();
    expect(status()?.textContent).toBe("");
  });
});
