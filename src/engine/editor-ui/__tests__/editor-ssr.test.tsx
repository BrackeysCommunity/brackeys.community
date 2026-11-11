// @vitest-environment node
import { Store } from "@tanstack/store";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys } from "../../collab/index";
import { createEditorSession, type SceneDefinition } from "../../editor/index";
import { createRegistry, defineGame } from "../../game/index";
import type { ProjectId } from "../../project/index";
import { EditorFrame, editorChrome, Island } from "../frame/EditorFrame";
import { EditorSkeleton } from "../frame/EditorSkeleton";
import type { EditorHost, ProjectConnectionState } from "../host";
import { Hotkey } from "../kit/key-hint";
import { SceneEditor } from "../SceneEditor";
import type { EditorHostState } from "../session/live-scene-editor";
import { fakeWorldGame } from "./fake-world-game";

const game = defineGame({
  id: "ssr",
  types: [],
  actions: [],
  createRuntime: () => ({ snapshot: () => null }),
});

const connecting: ProjectConnectionState = {
  status: "connecting",
  session: null,
  access: "write",
  stopped: {},
  error: null,
  unsynced: 0,
};

const host: EditorHost = {
  assetUrl: () => "",
  connect: () => ({
    getState: () => connecting,
    subscribe: () => () => {},
    onAssetChanged: () => () => {},
    destroy: () => {},
  }),
};

const island = (name: string) => (
  <Island>
    <button type="button">{name}</button>
  </Island>
);

describe("the editor renders on the server", () => {
  it("runs with no browser globals", () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");
  });

  it("renders the frame with every region", () => {
    const html = renderToString(
      <EditorFrame
        topLeft={island("site")}
        topRight={island("top-right")}
        context={island("context")}
        left={island("left")}
        right={island("right")}
        dock={island("dock")}
        status={island("status")}
        overlay={<div>overlay</div>}
      >
        <canvas />
      </EditorFrame>,
    );
    for (const name of ["site", "top-right", "context", "left", "right", "dock", "status"]) {
      expect(html).toContain(`>${name}</button>`);
    }
    expect(html).toContain("<canvas>");
  });

  it("renders a live editor's chrome and panels", () => {
    const scene: SceneDefinition = {
      v: 1,
      name: "ssr-yard",
      bounds: [0, 0, 2000, 1200],
      entities: [{ id: "pad", type: "marker", at: [100, 100] }],
    };
    const registry = createRegistry();
    const session = createEditorSession({
      doc: sceneToDoc(scene, { key: sequentialKeys("s") }),
      origin: { kind: "user", userId: "ada", name: "Ada" },
      name: "ssr-yard",
      registry,
      issuesDebounceMs: 0,
    });
    const notify = Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn(), success: vi.fn() });
    try {
      const html = renderToString(
        <EditorFrame
          {...editorChrome({
            session,
            host: new Store<EditorHostState>({ connection: "live", sceneChanged: false }),
            game: fakeWorldGame(registry).game,
            notify,
            onPlay: () => {},
            onReplay: () => {},
            onStop: () => {},
            onRestart: () => {},
          })}
        >
          <canvas />
        </EditorFrame>,
      );
      expect(html).toContain("je-panel-group");
      expect(html).toContain("pad");
    } finally {
      session.destroy();
    }
  });

  it("renders the skeleton's panels", () => {
    const html = renderToString(
      <EditorSkeleton host={host}>
        <canvas />
      </EditorSkeleton>,
    );
    expect(html).toContain("je-panel-group");
  });

  it("renders the scene editor booting", () => {
    const html = renderToString(
      <SceneEditor
        host={host}
        game={game}
        project={"ssr" as ProjectId}
        rapier={() => new Promise(() => {})}
      />,
    );
    expect(html).toContain("je-scene-canvas");
  });

  it("draws key caps for the platform the server can't know", () => {
    expect(renderToString(<Hotkey chord="Mod+S" />)).toContain(">Ctrl<");
  });
});
