import { afterEach, describe, expect, it } from "vite-plus/test";

import { sceneToDoc } from "../../collab/convert";
import { sequentialKeys } from "../../collab/keys";
import type { SceneOrigin } from "../../collab/types";
import { createRegistry } from "../../game/define";
import { memoryRuntimeView } from "../../headless/runtime-view";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/types";
import { createToolRouter } from "../../tool-router";
import { targetHandles } from "../gizmos/handles";
import { gizmoTarget, gizmoTextEnv, type GizmoTextEnv } from "../gizmos/target";
import { createEditorSession, type EditorSession } from "../session";
import { createToolHost, type ToolHost } from "../tool-host";

const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const registry = createRegistry(null);
/** Screen px per metre. */
const S = 100;
const VIEW = memoryRuntimeView({
  engine: { locales: { default: "en", available: ["en", "fr"] } },
  docs: {
    strings: {
      signs: {
        kind: "strings",
        v: 1,
        strings: [
          {
            key: "sign.welcome",
            en: "Welcome to the kitchen, where every behavior the engine has lives",
            fr: "Bienvenue",
          },
        ],
      },
    },
  },
});
const def = {
  v: SCENE_FORMAT_VERSION,
  name: "signs",
  bounds: [0, 0, 20, 10],
  entities: [
    {
      id: "sign",
      type: "marker",
      at: [4, 2],
      behaviors: { text: { key: "sign.welcome", size: 20, wrap: 120 } },
    },
  ],
} as SceneDefinition;

const opened: { host: ToolHost; session: EditorSession }[] = [];
afterEach(() => {
  for (const { host, session } of opened.splice(0)) {
    host.destroy();
    session.destroy();
  }
});

function open(text?: () => GizmoTextEnv | undefined) {
  const session = createEditorSession({
    doc: sceneToDoc(def, { key: sequentialKeys("t") }),
    origin: ada,
    name: "signs",
    registry,
    issuesDebounceMs: 0,
  });
  const host = createToolHost({
    session,
    router: createToolRouter(),
    toWorld: ({ x, y }) => [x / S, y / S],
    scale: () => S,
    ...(text ? { text } : {}),
  });
  opened.push({ host, session });
  session.select(["sign"]);
  return { host, session };
}

const moveHandle = (host: ToolHost) => host.overlay().handles?.find((h) => h.id === "move")?.at;

describe("the tool host's text gizmo", () => {
  it("measures a keyed text in the strings it is given, through the tools' context", () => {
    const env = gizmoTextEnv(VIEW);
    const { host, session } = open(() => env);
    const shown = gizmoTarget(session.getResolved(), registry, "sign", host.source())!;
    expect(shown.text).toEqual(
      gizmoTarget(session.getResolved(), registry, "sign", { doc: def, text: env })!.text,
    );
    const bracketed = gizmoTarget(session.getResolved(), registry, "sign")!;
    expect(shown.text!.hh).toBeGreaterThan(bracketed.text!.hh);

    const at = targetHandles(shown, { scale: S }).find((h) => h.id === "move")!.at;
    expect(moveHandle(host)).toEqual(at);
    expect(moveHandle(open().host)).not.toEqual(at);
  });

  it("keeps one source until the text it is measured in changes", () => {
    let env = gizmoTextEnv(VIEW);
    const { host } = open(() => env);
    const first = host.source();
    expect(host.source()).toBe(first);
    expect(first.text).toBe(env);
    env = gizmoTextEnv(VIEW, "fr");
    expect(host.source()).not.toBe(first);
    expect(host.source().text?.strings).toEqual({ "sign.welcome": "Bienvenue" });
  });
});
