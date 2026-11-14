import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { toolRegistry } from "../../__tests__/fixtures/test-tool";
import { sceneToDoc } from "../../collab/convert";
import { sequentialKeys } from "../../collab/keys";
import type { SceneDefinition } from "../../scene/types";
import { createToolRouter } from "../../tool-router";
import { createEditorSession } from "../session";
import { createToolHost, type ToolHost } from "../tool-host";
import { DEFAULT_SNAP } from "../tools";

const S = 100;

const scene = (): SceneDefinition => ({
  v: 1,
  name: "groups",
  bounds: [0, 0, 20, 20],
  entities: [
    { id: "crate", type: "solid", shape: ["box", 2, 2, 0.5, 0.5] },
    { id: "memo", type: "note", at: [6, 1], text: "Look here." },
  ],
});

const hosts: ToolHost[] = [];
afterEach(() => {
  for (const h of hosts.splice(0)) h.destroy();
  vi.useRealTimers();
});

function rig() {
  const session = createEditorSession({
    doc: sceneToDoc(scene(), { key: sequentialKeys("k") }),
    origin: { kind: "user", userId: "ada", name: "Ada" },
    name: "groups",
    registry: toolRegistry,
    issuesDebounceMs: 0,
  });
  const router = createToolRouter();
  const host = createToolHost({
    session,
    router,
    toWorld: ({ x, y }) => [x / S, y / S],
    scale: () => S,
    snap: { ...DEFAULT_SNAP, enabled: false },
  });
  hosts.push(host);
  const down = () =>
    router.dispatch({
      kind: "pointer",
      type: "down",
      screen: { x: 1900, y: 1900 },
      button: 0,
      deltaY: 0,
      native: { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false } as PointerEvent,
    });
  return { session, host, down };
}

describe("group and ungroup that do nothing", () => {
  it("say why beside the selection, until the next input or a moment passes", () => {
    vi.useFakeTimers();
    const { session, host, down } = rig();
    session.select(["memo"]);
    expect(host.command("group")).toBe(false);
    expect(host.overlay().readout).toEqual({
      at: expect.any(Array),
      text: "Nothing selected can go under a node.",
    });
    vi.advanceTimersByTime(3000);
    expect(host.overlay().readout).toBeUndefined();

    session.select(["crate"]);
    expect(host.command("ungroup")).toBe(false);
    expect(host.overlay().readout?.text).toBe("Select a node to ungroup.");
    down();
    expect(host.overlay().readout).toBeUndefined();

    expect(host.command("ungroup")).toBe(false);
    expect(host.command("select-all")).toBe(true);
    expect(host.overlay().readout).toBeUndefined();
  });

  it("stay quiet with nothing selected", () => {
    const { host } = rig();
    expect(host.command("group")).toBe(false);
    expect(host.command("ungroup")).toBe(false);
    expect(host.overlay().readout).toBeUndefined();
  });
});
