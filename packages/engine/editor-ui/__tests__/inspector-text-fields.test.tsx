// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createProjectSession,
  layoutToDoc,
  memoryDocHost,
  sceneToDoc,
  seedProjectDoc,
  sequentialKeys,
  type ProjectSession,
  type SceneOrigin,
} from "../../collab/index";
import { createEditorSession, type EditorSession } from "../../editor/index";
import { createRegistry } from "../../game/index";
import { createKindRegistry, type AssetEntry, type DocLayout } from "../../project/index";
import { gameSettingsKind } from "../../project/kinds/game-settings";
import { SCENE_FORMAT_VERSION, type SceneDefinition } from "../../scene/types";
import { KitProvider } from "../kit/index";
import { EditorInspector } from "../panels/EditorInspector";

const registry = createRegistry();
const kinds = createKindRegistry(null);
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const PROJECT = "yard";
const SCENE_DOC = `scene:${PROJECT}.klevel`;
const created = { at: 1, by: "seed" };
const entry = (key: string, id: string, kind: string, path: string, extra = {}): AssetEntry => ({
  key,
  id,
  kind,
  path,
  created,
  ...extra,
});

const scene = (text: Record<string, unknown>): SceneDefinition => ({
  v: SCENE_FORMAT_VERSION,
  name: "level",
  bounds: [0, 0, 400, 300],
  entities: [{ id: "sign", type: "marker", at: [10, 10], behaviors: { text } }],
});

const sessions: ProjectSession[] = [];
const editors: EditorSession[] = [];

async function open(text: Record<string, unknown>) {
  const host = memoryDocHost();
  const assets = [
    entry("klevel", "level", "scene", "scenes/level.json"),
    entry("kset", "game-settings", "game-settings", "game.settings.json"),
    entry("kfont", "sign-font", "font", "fonts/sign.ttf", {
      sha256: "f".repeat(64),
      bytes: 64,
      meta: { format: "ttf" },
    }),
  ];
  seedProjectDoc(
    host.doc(`project:${PROJECT}`),
    {
      meta: { projectId: PROJECT, layout: 1, name: "Yard" },
      assets: Object.fromEntries(assets.map((a) => [a.key, a])),
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  sceneToDoc(scene(text), { doc: host.doc(SCENE_DOC), key: sequentialKeys("s") });
  layoutToDoc(host.doc(`asset:${PROJECT}.kset`), gameSettingsKind.layout as DocLayout, {
    kind: "game-settings",
    v: 2,
    engine: { locales: { default: "en", available: ["en"], fonts: { default: "sign-font" } } },
    game: {},
  });
  const session = await createProjectSession({
    project: PROJECT,
    openDoc: host.client().openDoc,
    origin: ada,
    registry,
    kinds,
  });
  sessions.push(session);
  const editor = createEditorSession({
    doc: (await session.open(SCENE_DOC)).doc,
    origin: ada,
    name: "level",
    registry,
  });
  editors.push(editor);
  editor.select(["sign"]);
  render(
    <KitProvider host={{ storage: null }}>
      <EditorInspector session={editor} project={session} />
    </KitProvider>,
  );
  return editor;
}

function textOf(editor: EditorSession): Record<string, unknown> | undefined {
  const sign = editor.getDoc().entities?.find((e) => e.id === "sign");
  const behaviors = sign?.behaviors as { text?: Record<string, unknown> } | undefined;
  return behaviors?.text;
}

afterEach(() => {
  cleanup();
  for (const e of editors.splice(0)) e.destroy();
  for (const s of sessions.splice(0)) s.destroy();
  vi.clearAllMocks();
});

describe("the text behavior's fields", () => {
  it("names the project font an unset font draws in", async () => {
    await open({ text: "Hi" });
    const font = await screen.findByRole("combobox", { name: "behaviors.text.font" });
    await waitFor(() => expect((font as HTMLInputElement).placeholder).toBe("Project font (sign)"));
  });

  it("edits the placeholder values as keys and values", async () => {
    const editor = await open({ text: "{n} coins" });
    const key = await screen.findByRole("textbox", { name: "behaviors.text.vars new key" });
    await act(async () => {
      fireEvent.change(key, { target: { value: "n" } });
      fireEvent.keyDown(key, { key: "Enter" });
    });
    await waitFor(() => expect(textOf(editor)?.vars).toEqual({ n: "" }));
    const n = await screen.findByRole("textbox", { name: "behaviors.text.vars.n" });
    await act(async () => {
      fireEvent.change(n, { target: { value: "3" } });
      fireEvent.keyDown(n, { key: "Enter" });
    });
    await waitFor(() => expect(textOf(editor)?.vars).toEqual({ n: 3 }));
  });
});
