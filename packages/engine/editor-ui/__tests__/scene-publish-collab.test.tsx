// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import {
  createProjectSession,
  memoryDocHost,
  sceneToDoc,
  seedProjectDoc,
  sequentialKeys,
  type ProjectSession,
  type SceneOrigin,
} from "../../collab/index";
import { createEditorSession, type EditorSession } from "../../editor/index";
import { createRegistry, defineGame } from "../../game/index";
import {
  createKindRegistry,
  formatReleaseManifest,
  parseSceneVersion,
  prefabKind,
  sceneKind,
  sceneVersionId,
  type ReleaseManifest,
} from "../../project/index";
import { ENGINE_FORMATS } from "../../project/release";
import { AGENT_SURFACE_VERSION } from "../../scene/agent-surface";
import { SCENE_FORMAT_VERSION } from "../../scene/index";
import { ENGINE_VERSION } from "../../version";
import type { EditorLiveHost, LivePublished } from "../host";
import { ScenePublishDialog } from "../panels/publish/ScenePublishDialog";
import { prefabsReady } from "../session/live-scene-editor";
import { buildOpenSceneVersion } from "../session/open-scene-version";
import type { EditorProjectLink } from "../session/use-scene-editor";
import { fakeLiveHost } from "./fake-live-host";

const game = defineGame({
  id: "livy",
  types: [],
  actions: [],
  world: { physics: "none" },
  live: { timings: [] },
  createRuntime: () => ({ snapshot: () => null }),
});
const registry = createRegistry(game);
const kinds = createKindRegistry(game, [sceneKind, prefabKind]);

const marker = (id: string, x: number) => ({ id, type: "marker", at: [x, 1] as [number, number] });

const closers: { destroy(): void }[] = [];
afterEach(() => {
  cleanup();
  for (const c of closers.splice(0)) c.destroy();
});

function seed() {
  const host = memoryDocHost();
  seedProjectDoc(
    host.doc("project:p"),
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: {
        hall: {
          key: "hall",
          id: "hall",
          kind: "scene",
          path: "hall.json",
          created: { at: 0, by: "seed" },
        },
      },
      history: {},
      code: {},
      build: {},
    },
    { kind: "migration" },
  );
  sceneToDoc(
    {
      v: SCENE_FORMAT_VERSION,
      name: "hall",
      bounds: [0, 0, 10, 10],
      entities: [marker("start", 1)],
    },
    { doc: host.doc("scene:p.hall"), key: sequentialKeys("t") },
  );
  return host;
}

async function join(host: ReturnType<typeof seed>, origin: SceneOrigin) {
  const project: ProjectSession = await createProjectSession({
    project: "p",
    openDoc: host.client().openDoc,
    origin,
    registry,
    kinds,
  });
  closers.push(project);
  await prefabsReady(project);
  const scene = await project.open("scene:p.hall");
  const editor: EditorSession = createEditorSession({
    doc: scene.doc,
    origin,
    name: "hall",
    registry,
  });
  closers.push(editor);
  return { project, doc: scene.doc, editor };
}

/** A preview release of the scene as `doc` holds it now. */
async function releaseOf(project: ProjectSession, doc: Y.Doc): Promise<ReleaseManifest> {
  const made = await buildOpenSceneVersion(project, "hall", doc, registry, game);
  if (!made.ok) throw new Error(JSON.stringify(made.issues));
  const scene = made.version.assets.hall!;
  const measured = { codeBytes: 0, wasmBytes: 0, firstLoadBytes: 0, assetBytes: 0, dataBytes: 0 };
  return {
    kind: "release",
    v: 1,
    engine: {
      version: ENGINE_VERSION,
      agentSurface: AGENT_SURFACE_VERSION,
      formats: { ...ENGINE_FORMATS },
    },
    game: { id: game.id, configHash: null, saveVersion: null },
    project: {
      id: "p",
      name: "P",
      snapshot: "0".repeat(64),
      snapshotEngine: ENGINE_VERSION,
      build: project.hashes,
    },
    build: { hash: "1".repeat(64), target: "web", rapier: null, entry: "code/main.js", files: [] },
    time: { kind: "fixed", rate: 60, catchUp: null, wakeOnPointerMove: false },
    replay: { acrossPlatforms: true },
    flow: { start: "hall", scenes: [made.version.entry] },
    projectBundle: { entries: [], bytes: 0 },
    assets: { hall: { ...scene, file: `data/${scene.sha256}.json` } },
    credits: { assets: [], missing: [], code: [] },
    budget: {
      limits: { codeBytes: 1, firstLoadBytes: 1, totalBytes: 1, fileBytes: 1 },
      measured: { ...measured, totalBytes: 0, largestFile: { path: "", bytes: 0 } },
      over: [],
    },
    pwa: null,
  };
}

/** A host that keeps every published version and holds each upload until `finish`. */
function holdingHost(manifest: ReleaseManifest) {
  const published: { text: string; texts: Readonly<Record<string, string>> }[] = [];
  let finish: () => void = () => {};
  const publish = vi.fn<EditorLiveHost["publish"]>(async (text, texts, opts) => {
    published.push({ text, texts });
    await new Promise<void>((resolve) => (finish = resolve));
    const parsed = parseSceneVersion(text);
    if (!parsed.ok) throw new Error("unreadable version");
    const done: LivePublished = {
      versionId: await sceneVersionId(parsed.version),
      scene: "hall",
      number: published.length,
      created: true,
      channel: opts.channel,
    };
    return done;
  });
  const live = fakeLiveHost({
    base: vi.fn<EditorLiveHost["base"]>(async (_scene, channel) => ({
      channel,
      release: { id: "2".repeat(64), version: 1, manifest: formatReleaseManifest(manifest) },
      live: null,
      texts: {},
      latest: published.length > 0 ? published.length : null,
    })),
    publish,
  });
  return { live, publish, published, finish: () => finish() };
}

const sceneTextOf = (version: { text: string; texts: Readonly<Record<string, string>> }) => {
  const parsed = parseSceneVersion(version.text);
  if (!parsed.ok) throw new Error("unreadable version");
  return version.texts[parsed.version.assets.hall!.sha256]!;
};

const ids = (editor: EditorSession) => (editor.getResolved().entities ?? []).map((e) => e.id);

/** Ada's doc as it is now, apart from the session, so later edits don't reach it. */
function frozen(doc: Y.Doc): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  return copy;
}

describe("publishing while a collaborator edits", () => {
  it("publishes exactly the publisher's doc at Publish; a later edit waits for the next version", async () => {
    const host = seed();
    const ada = await join(host, { kind: "user", userId: "ada", name: "Ada" });
    const bob = await join(host, { kind: "user", userId: "bob", name: "Bob" });
    const { live, publish, published, finish } = holdingHost(await releaseOf(ada.project, ada.doc));
    const link = { session: ada.project, doc: "scene:p.hall", scene: "hall" } as EditorProjectLink;
    render(
      <ScenePublishDialog live={live} session={ada.editor} project={link} onClose={() => {}} />,
    );
    act(() => {
      bob.editor.dispatch({ label: "Flag", ops: [{ op: "add", entity: marker("flag", 2) }] });
    });
    expect(ids(ada.editor)).toContain("flag");
    const button = () => screen.getByRole("button", { name: "Publish" });
    await waitFor(() => expect(button().hasAttribute("disabled")).toBe(false));

    const at: { publish?: Y.Doc } = {};
    act(() => {
      fireEvent.click(button());
      at.publish = frozen(ada.doc);
      bob.editor.dispatch({ label: "Late", ops: [{ op: "add", entity: marker("late", 3) }] });
    });
    expect(ids(ada.editor)).toContain("late");
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    await act(async () => finish());

    const expected = await buildOpenSceneVersion(ada.project, "hall", at.publish!, registry, game);
    if (!expected.ok) throw new Error(JSON.stringify(expected.issues));
    const first = parseSceneVersion(published[0]!.text);
    expect(first.ok && (await sceneVersionId(first.version))).toBe(expected.id);
    expect(sceneTextOf(published[0]!)).toContain('"flag"');
    expect(sceneTextOf(published[0]!)).not.toContain('"late"');

    await waitFor(() => expect(button().hasAttribute("disabled")).toBe(false));
    act(() => fireEvent.click(button()));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    await act(async () => finish());
    const now = await buildOpenSceneVersion(ada.project, "hall", ada.doc, registry, game);
    if (!now.ok) throw new Error(JSON.stringify(now.issues));
    const second = parseSceneVersion(published[1]!.text);
    expect(second.ok && (await sceneVersionId(second.version))).toBe(now.id);
    expect(now.id).not.toBe(expected.id);
    expect(sceneTextOf(published[1]!)).toContain('"late"');
  });
});
