import { afterEach, describe, expect, it } from "vite-plus/test";

import { sceneToDoc } from "../../collab/convert";
import { sequentialKeys } from "../../collab/keys";
import { createRegistry } from "../../game/define";
import { encodeRow } from "../../scene/grid";
import type { ShapeObj } from "../../scene/types";
import { createToolRouter } from "../../tool-router";
import { createEditorSession, type EditorSession } from "../session";
import { setTileBrush } from "../store";
import { createToolHost, type ToolHost } from "../tool-host";
import { DEFAULT_SNAP } from "../tools";

const registry = createRegistry();
const S = 100;
const CELL = 0.25;

let open: { session: EditorSession; host: ToolHost } | null = null;
afterEach(() => {
  open?.host.destroy();
  open?.session.destroy();
  open = null;
});

function rig() {
  const doc = sceneToDoc(
    {
      v: 5,
      name: "tiles",
      bounds: [0, 0, 10, 10],
      settings: { grid: { kind: "square", cell: [CELL, CELL] } },
      entities: [
        {
          id: "floor",
          type: "tilemap",
          at: [1, 1],
          tileset: "sheet",
          cells: { "0,0": [encodeRow([1])] },
        },
      ],
    },
    { key: sequentialKeys("k") },
  );
  const session = createEditorSession({
    doc,
    origin: { kind: "user", userId: "ada", name: "Ada" },
    name: "tiles",
    registry,
    issuesDebounceMs: 0,
  });
  const router = createToolRouter();
  const host = createToolHost({
    session,
    router,
    toWorld: ({ x, y }) => [x / S, y / S],
    scale: () => S,
    snap: { ...DEFAULT_SNAP, enabled: false },
    now: () => 0,
  });
  open = { session, host };
  const hover = (c: number, r: number) =>
    router.dispatch({
      kind: "pointer",
      type: "move",
      screen: { x: (1 + (c + 0.5) * CELL) * S, y: (1 + (r + 0.5) * CELL) * S },
      button: 0,
      deltaY: 0,
      native: { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false } as PointerEvent,
    });
  return { session, host, hover };
}

const corners = (s: ShapeObj) => (s.type === "poly" ? s.pts : []);

describe("the tile brush's hover ghost", () => {
  it("ghosts each tile the stamp paints at the hovered cell, and nothing for the eraser", () => {
    const r = rig();
    setTileBrush(r.session.store, { tiles: [[3, 0, 3]] });
    r.host.setTool("tile-brush");
    r.hover(2, 4);
    const ghosts = r.host.overlay().ghosts ?? [];
    expect(ghosts.map((g) => corners(g.shape)[0])).toEqual([
      [1 + 2 * CELL, 1 + 4 * CELL],
      [1 + 4 * CELL, 1 + 4 * CELL],
    ]);
    expect(ghosts.every((g) => g.valid)).toBe(true);

    r.host.setTool("tile-erase");
    r.hover(2, 4);
    expect(r.host.overlay().ghosts).toBeUndefined();
    expect(r.host.overlay().outlines).toHaveLength(1);
  });
});
