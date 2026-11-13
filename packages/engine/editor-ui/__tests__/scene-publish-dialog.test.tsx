// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type * as Y from "yjs";

import {
  createProjectSession,
  memoryDocHost,
  sceneToDoc,
  seedProjectDoc,
  sequentialKeys,
  type ProjectSession,
  type SceneOrigin,
} from "../../collab/index";
import { appendLog } from "../../collab/log";
import { createEditorSession, createKeymap, type EditorSession } from "../../editor/index";
import { createRegistry, defineGame } from "../../game/index";
import { SWAP_TIMING_WORDS, type SwapTiming } from "../../game/live";
import {
  createKindRegistry,
  formatReleaseManifest,
  prefabKind,
  sceneKind,
  type AssetEntry,
  type ReleaseManifest,
} from "../../project/index";
import { ENGINE_FORMATS } from "../../project/release";
import { AGENT_SURFACE_VERSION } from "../../scene/agent-surface";
import { SCENE_FORMAT_VERSION } from "../../scene/index";
import { ENGINE_VERSION } from "../../version";
import type {
  EditorLiveHost,
  EditorNotify,
  LiveBaseView,
  LiveVersionView,
  LiveWording,
  PublishChannel,
} from "../host";
import { EditorToolbar, PUBLISH_SCENE_ICON, PUBLISH_SCENE_TOOLTIP } from "../panels/EditorToolbar";
import { TIMING_UNDECLARED } from "../panels/publish/ChoiceGroup";
import { PRODUCTION_PUBLISHERS_ONLY, productionConfirmText } from "../panels/publish/live-wording";
import {
  EDITORS_UNCHECKED,
  editedSinceText,
  IN_PLACE,
  progressOf,
  REBUILT,
  ScenePublishDialog,
  TODAY_UNCHECKED,
  WHERE_TEXT,
} from "../panels/publish/ScenePublishDialog";
import { PUBLISH_PANEL } from "../panels/registry";
import { prefabsReady } from "../session/live-scene-editor";
import {
  buildOpenSceneVersion,
  versionDocNames,
  watchProjectDocs,
} from "../session/open-scene-version";
import type { EditorProjectLink } from "../session/use-scene-editor";
import { FAKE_LIVE_WORDING, fakeLiveHost, type FakeLiveHost } from "./fake-live-host";

const jo: SceneOrigin = { kind: "user", userId: "jo", name: "Jo" };

const entry = (key: string, kind: string, path: string): AssetEntry => ({
  key,
  id: key,
  kind,
  path,
  created: { at: 0, by: "seed" },
});

const marker = (id: string, x: number) => ({ id, type: "marker", at: [x, 1] as [number, number] });

const sessions: (ProjectSession | EditorSession)[] = [];
afterEach(() => {
  cleanup();
  for (const s of sessions.splice(0)) s.destroy();
});

/** A release of the scene as `doc` holds it now, with `edit` applied to its manifest. */
async function releaseOf(
  project: ProjectSession,
  doc: Y.Doc,
  game: ReturnType<typeof defineGame>,
  edit: (m: ReleaseManifest) => void = () => {},
) {
  const made = await buildOpenSceneVersion(project, "hall", doc, createRegistry(game), game);
  if (!made.ok) throw new Error(JSON.stringify(made.issues));
  const scene = made.version.assets.hall!;
  const manifest: ReleaseManifest = {
    kind: "release",
    v: 1,
    engine: {
      version: ENGINE_VERSION,
      agentSurface: AGENT_SURFACE_VERSION,
      formats: { ...ENGINE_FORMATS },
    },
    game: { id: game.id, configHash: game.configHash ?? null, saveVersion: null },
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
      measured: {
        codeBytes: 0,
        wasmBytes: 0,
        firstLoadBytes: 0,
        assetBytes: 0,
        dataBytes: 0,
        totalBytes: 0,
        largestFile: { path: "", bytes: 0 },
      },
      over: [],
    },
    pwa: null,
  };
  edit(manifest);
  return { manifest, texts: Object.fromEntries(made.texts) };
}

type Setup = {
  timings?: SwapTiming[];
  publisher?: boolean;
  manifest?: (m: ReleaseManifest) => void;
  versions?: LiveVersionView[];
  today?: number;
  latest?: number | null;
  /** How many times preview's base fails before it loads. */
  baseFails?: number;
  /** Replaces the fake host's members. */
  live?: Partial<FakeLiveHost>;
};

async function setup(opts: Setup = {}) {
  const game = defineGame({
    id: "livy",
    types: [],
    actions: [],
    world: { physics: "none" },
    live: { timings: opts.timings ?? ["boundary"] },
    createRuntime: () => ({ snapshot: () => null }),
  });
  const registry = createRegistry(game);
  const kinds = createKindRegistry(game, [sceneKind, prefabKind]);
  const host = memoryDocHost();
  seedProjectDoc(
    host.doc("project:p"),
    {
      meta: { projectId: "p", layout: 1, name: "P" },
      assets: { hall: entry("hall", "scene", "hall.json") },
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
      entities: [marker("start", 1), marker("flag", 2)],
    },
    { doc: host.doc("scene:p.hall"), key: sequentialKeys("t") },
  );
  const project = await createProjectSession({
    project: "p",
    openDoc: host.client().openDoc,
    origin: jo,
    registry,
    kinds,
  });
  sessions.push(project);
  await prefabsReady(project);
  const sceneDoc = await project.open("scene:p.hall");
  const editor = createEditorSession({
    doc: sceneDoc.doc,
    origin: jo,
    name: "hall",
    registry,
    issuesDebounceMs: 0,
  });
  sessions.push(editor);
  const release = await releaseOf(project, sceneDoc.doc, game, opts.manifest);

  const baseOf = (channel: PublishChannel): LiveBaseView => ({
    channel,
    release: {
      id: "2".repeat(64),
      version: channel === "preview" ? 8 : 7,
      manifest: formatReleaseManifest(release.manifest),
    },
    live: null,
    texts: release.texts,
    latest: opts.latest ?? 3,
  });
  const publish = vi.fn<EditorLiveHost["publish"]>(async (_text, _texts, o, onProgress) => {
    onProgress?.({ step: "begin" });
    onProgress?.({ step: "upload", sentBytes: 1, totalBytes: 1 });
    onProgress?.({ step: "commit" });
    return {
      versionId: "3".repeat(64),
      scene: "hall",
      number: 4,
      created: true,
      channel: o.channel,
    };
  });
  let baseFails = opts.baseFails ?? 0;
  const live = fakeLiveHost(
    {
      base: vi.fn<EditorLiveHost["base"]>(async (_scene, channel) => {
        if (channel === "preview" && baseFails-- > 0) throw new Error("The site didn't answer.");
        return baseOf(channel);
      }),
      publish,
      list: vi.fn<EditorLiveHost["list"]>(async () => opts.versions ?? []),
      usage: vi.fn<EditorLiveHost["usage"]>(async () => ({
        today: opts.today ?? 6,
        versions: 3,
        bytes: 4000,
      })),
      ...opts.live,
    },
    opts.publisher ?? false,
  );
  const success = vi.fn();
  const notify: EditorNotify = Object.assign(vi.fn(), {
    success,
    warning: vi.fn(),
    error: vi.fn(),
  });
  const link = { session: project, doc: "scene:p.hall", scene: "hall" } as EditorProjectLink;
  const onClose = vi.fn();
  render(
    <ScenePublishDialog
      live={live}
      session={editor}
      project={link}
      notify={notify}
      onClose={onClose}
    />,
  );
  return { editor, project, sceneDoc, live, publish, success, onClose };
}

const radio = (name: string | RegExp) => screen.getByRole("radio", { name }) as HTMLInputElement;
const checks = () => within(screen.getByRole("list", { name: "Checks" }));
const checkLine = async (id: string) =>
  waitFor(() => {
    const line = document.querySelector(`[data-check="${id}"]`);
    expect(line).not.toBeNull();
    return line!.textContent;
  });
const publishButton = () => screen.getByRole("button", { name: "Publish" });

describe("Publish scene", () => {
  it("offers only the game's declared timings, the others disabled and saying why", async () => {
    await setup({ timings: ["boundary"] });
    expect(radio(SWAP_TIMING_WORDS["next-load"].label).disabled).toBe(false);
    expect(radio(SWAP_TIMING_WORDS["next-load"].label).checked).toBe(true);
    expect(radio(SWAP_TIMING_WORDS.boundary.label).disabled).toBe(false);
    const now = radio(SWAP_TIMING_WORDS.now.label);
    expect(now.disabled).toBe(true);
    expect(now.getAttribute("aria-description")).toBe(TIMING_UNDECLARED);
    fireEvent.focus(now.closest("label")!);
    expect(await screen.findByText(TIMING_UNDECLARED)).toBeTruthy();
  });

  it("takes the note's limit and placeholder from the host", async () => {
    await setup();
    const note = screen.getByRole("textbox", { name: "Note" }) as HTMLTextAreaElement;
    expect(note.maxLength).toBe(200);
    expect(note.placeholder).toBe("What changed, for your team (up to 200 characters)");
  });

  it("keeps Production for publishers, disabled with its sentence for everyone else", async () => {
    await setup({ publisher: false });
    expect(radio(/^Preview/).checked).toBe(true);
    expect(screen.getByText(WHERE_TEXT.preview, { exact: false })).toBeTruthy();
    const production = radio(/^Production/);
    expect(production.disabled).toBe(true);
    expect(production.getAttribute("aria-description")).toBe(PRODUCTION_PUBLISHERS_ONLY);
    expect(PRODUCTION_PUBLISHERS_ONLY).toBe("Only publishers can choose this.");
    // The suffix takes the choice's own size.
    expect((await screen.findByText("· on v8")).getAttribute("data-size")).toBe("xs");
  });

  it("asks a publisher before Production, and publishes only on yes", async () => {
    const { publish, success, onClose } = await setup({ publisher: true, timings: ["now"] });
    fireEvent.click(radio(/^Production/));
    fireEvent.click(radio(SWAP_TIMING_WORDS.now.label));
    await checkLine("fits").then((text) => expect(text).toBe("Fits v7"));
    await waitFor(() => expect(publishButton().hasAttribute("disabled")).toBe(false));
    fireEvent.click(publishButton());
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(productionConfirmText("hall@4", "now"))).toBeTruthy();
    expect(productionConfirmText("hall@4", "now")).toBe(
      "Players will get hall@4 now. You can roll back or stop it at any time.",
    );
    expect(publish).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(publish.mock.calls[0]![2]).toEqual({ channel: "production", timing: "now" });
    await waitFor(() => expect(success).toHaveBeenCalledWith("hall@4 is live on production."));
    expect(onClose).toHaveBeenCalled();
  });

  it("publishes to preview at once with the note, and toasts where it is live", async () => {
    const { publish, success } = await setup();
    await checkLine("fits");
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), {
      target: { value: "  moved the flag " },
    });
    await waitFor(() => expect(publishButton().hasAttribute("disabled")).toBe(false));
    fireEvent.click(publishButton());
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(publish.mock.calls[0]![2]).toEqual({
      channel: "preview",
      timing: "next-load",
      note: "moved the flag",
    });
    await waitFor(() => expect(success).toHaveBeenCalledWith("hall@4 is live on preview."));
  });

  it("counts the upload in bytes while a publish of several files runs", async () => {
    let finish!: () => void;
    const held = new Promise<void>((resolve) => (finish = resolve));
    const publish = vi.fn<EditorLiveHost["publish"]>(async (_text, _texts, o, onProgress) => {
      onProgress?.({ step: "begin" });
      onProgress?.({ step: "upload", sentBytes: 0, totalBytes: 20_480 });
      onProgress?.({ step: "upload", sentBytes: 14_336, totalBytes: 20_480 });
      await held;
      return {
        versionId: "3".repeat(64),
        scene: "hall",
        number: 4,
        created: true,
        channel: o.channel,
      };
    });
    await setup({ live: { publish } });
    await checkLine("fits");
    await waitFor(() => expect(publishButton().hasAttribute("disabled")).toBe(false));
    fireEvent.click(publishButton());
    expect(await screen.findByText("Uploading 14 KB of 20 KB…")).toBeTruthy();
    expect(screen.queryByText(/files…/)).toBeNull();
    finish();
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
  });

  it("words each publish step, the upload in bytes", () => {
    expect(progressOf({ step: "upload", sentBytes: 0, totalBytes: 2_048 })).toEqual({
      text: "Uploading 0 B of 2 KB…",
      value: 0,
    });
    expect(progressOf({ step: "upload", sentBytes: 0, totalBytes: 0 }).value).toBeNull();
    expect(progressOf({ step: "commit" }).text).toBe("Saving the version…");
  });

  it("says what changed and that players' worlds update in place", async () => {
    const { editor } = await setup();
    act(() => {
      editor.dispatch({
        label: "Edit",
        ops: [
          { op: "move", refs: ["flag"], by: [1, 0] },
          { op: "add", entity: marker("a", 4) },
          { op: "add", entity: marker("b", 5) },
          { op: "remove", refs: ["start"] },
        ],
      });
    });
    await waitFor(() =>
      expect(document.querySelector('[data-check="diff"]')?.textContent).toBe(
        `1 entity changed, 2 added, 1 removed. ${IN_PLACE}`,
      ),
    );
  });

  it("says players' worlds are rebuilt when the bounds change", async () => {
    const { editor } = await setup();
    act(() => {
      editor.dispatch({
        label: "Grow",
        ops: [{ op: "setScene", set: { bounds: [0, 0, 20, 10] } }],
      });
    });
    await waitFor(() =>
      expect(document.querySelector('[data-check="diff"]')?.textContent).toBe(REBUILT),
    );
  });

  it("blocks Publish on a compatibility issue, with its message", async () => {
    await setup({
      manifest: (m) => {
        m.game.id = "another-game";
      },
    });
    const text = await checkLine("fits");
    expect(text).toBe("hall@4 belongs to another game or game configuration.");
    expect(publishButton().hasAttribute("disabled")).toBe(true);
  });

  it("shows data size and today's count in the host's words, and blocks at the day's limit", async () => {
    await setup({ today: 100 });
    expect(await checkLine("data")).toMatch(/^Data: \d+ B of 2 MB$/);
    expect(await checkLine("today")).toBe("Today: 100 of 100 versions");
    expect(publishButton().hasAttribute("disabled")).toBe(true);
  });

  it("tones the Data and Today lines by the host's usage level", async () => {
    const level = vi.fn<LiveWording["level"]>((used, max) =>
      max === FAKE_LIVE_WORDING.versionsPerDay ? (used >= 6 ? "warn" : "ok") : "ok",
    );
    await setup({ live: { wording: { ...FAKE_LIVE_WORDING, level } } });
    await checkLine("today");
    expect(document.querySelector('[data-check="today"]')?.getAttribute("data-tone")).toBe(
      "warning",
    );
    expect(document.querySelector('[data-check="data"]')?.getAttribute("data-tone")).toBe("muted");
    expect(level).toHaveBeenCalledWith(6, FAKE_LIVE_WORDING.versionsPerDay);
  });

  it("tones Data at exactly the limit as a warning that doesn't hold Publish", async () => {
    // The host's level reads "full" from 100% on; only a version over the limit is refused.
    const level = vi.fn<LiveWording["level"]>((_used, max) =>
      max === FAKE_LIVE_WORDING.dataMaxBytes ? "full" : "ok",
    );
    await setup({ live: { wording: { ...FAKE_LIVE_WORDING, level } } });
    await checkLine("data");
    expect(document.querySelector('[data-check="data"]')?.getAttribute("data-tone")).toBe(
      "warning",
    );
    await waitFor(() => expect(publishButton().hasAttribute("disabled")).toBe(false));
  });

  it("names the version a publish creates", async () => {
    await setup({ latest: 3 });
    await waitFor(() =>
      expect(
        screen.getByText(
          "Publishes hall@4: updates this one level for players of the current release.",
        ),
      ).toBeTruthy(),
    );
  });

  it("labels the Checks list by its heading, every child of the list a list item", async () => {
    await setup();
    await checkLine("data");
    const list = screen.getByRole("list", { name: "Checks" });
    expect(list.children.length).toBeGreaterThan(0);
    for (const child of list.children) expect(child.getAttribute("role")).toBe("listitem");
  });

  it("names who edited the scene since its newest version, from the doc's log", async () => {
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    const { sceneDoc, editor } = await setup({
      versions: [
        {
          scene: "hall",
          number: 3,
          id: "4".repeat(64),
          createdAt,
          createdBy: "Jo",
          note: null,
          dataBytes: 10,
          pointers: [],
          blocked: null,
          hidden: null,
          collected: false,
          removal: null,
        },
      ],
    });
    act(() => {
      sceneDoc.doc.transact(() =>
        appendLog(sceneDoc.doc, {
          actor: { kind: "user", userId: "old", name: "Old" },
          label: "Before",
          keys: [],
          at: Date.parse(createdAt) - 1000,
        }),
      );
      editor.dispatch({ label: "Nudge", ops: [{ op: "move", refs: ["flag"], by: [1, 0] }] });
      sceneDoc.doc.transact(() =>
        appendLog(sceneDoc.doc, {
          actor: { kind: "user", userId: "sam", name: "Sam" },
          label: "Tweak",
          keys: [],
        }),
      );
    });
    await waitFor(() =>
      expect(document.querySelector('[data-check="editors"]')?.textContent).toBe(
        "Edited since hall@3 by Jo, Sam.",
      ),
    );
    expect(checks().queryByText(/Old/)).toBeNull();
  });

  it("shows a refusal's message and hint in the dialog", async () => {
    const { publish, onClose } = await setup();
    publish.mockRejectedValueOnce({
      code: "live-quota",
      message: "Today's 100 versions are used.",
      hint: "Publish again tomorrow.",
    });
    await checkLine("fits");
    await waitFor(() => expect(publishButton().hasAttribute("disabled")).toBe(false));
    fireEvent.click(publishButton());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Today's 100 versions are used.");
    expect(alert.textContent).toContain("Publish again tomorrow.");
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(radio(SWAP_TIMING_WORDS.boundary.label));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("keeps a refusal on screen while an edit runs the checks again", async () => {
    const { publish, editor } = await setup();
    publish.mockRejectedValueOnce({
      code: "quota-exceeded",
      message: "Too big.",
      hint: "Split it.",
    });
    await checkLine("fits");
    await waitFor(() => expect(publishButton().hasAttribute("disabled")).toBe(false));
    fireEvent.click(publishButton());
    expect((await screen.findByRole("alert")).textContent).toContain("Too big.");
    act(() => {
      editor.dispatch({ label: "Nudge", ops: [{ op: "move", refs: ["flag"], by: [1, 0] }] });
    });
    await waitFor(() =>
      expect(document.querySelector('[data-check="diff"]')?.textContent).toBe(
        `1 entity changed. ${IN_PLACE}`,
      ),
    );
    expect(screen.getByRole("alert").textContent).toContain("Split it.");
  });

  it("says when today's count or the scene's versions couldn't be checked", async () => {
    await setup({
      live: {
        usage: vi.fn<EditorLiveHost["usage"]>(async () => {
          throw new Error("offline");
        }),
        list: vi.fn<EditorLiveHost["list"]>(async () => {
          throw new Error("offline");
        }),
      },
    });
    expect(await checkLine("today")).toBe(TODAY_UNCHECKED);
    expect(await checkLine("editors")).toBe(EDITORS_UNCHECKED);
    await waitFor(() => expect(publishButton().hasAttribute("disabled")).toBe(false));
  });

  it("loads a channel's base again on Try again", async () => {
    const { live } = await setup({ baseFails: 1 });
    const failed = await screen.findByText("The site didn't answer.");
    expect(publishButton().hasAttribute("disabled")).toBe(true);
    fireEvent.click(
      within(failed.closest('[role="listitem"]')!).getByRole("button", {
        name: "Try again",
      }),
    );
    expect(await checkLine("fits")).toBe("Fits v8");
    expect(live.base).toHaveBeenCalledTimes(4);
  });
});

describe("the docs a version carries", () => {
  it("are named by the version, and their updates followed until unsubscribed", async () => {
    const { project, sceneDoc, editor } = await setup();
    const game = editor.registry.game!;
    const made = await buildOpenSceneVersion(project, "hall", sceneDoc.doc, editor.registry, game);
    if (!made.ok) throw new Error(JSON.stringify(made.issues));
    expect(versionDocNames(project, made.version)).toEqual(["scene:p.hall"]);
    const changed = vi.fn();
    const off = watchProjectDocs(project, ["scene:p.hall"], changed);
    act(() => {
      editor.dispatch({ label: "Nudge", ops: [{ op: "move", refs: ["flag"], by: [1, 0] }] });
    });
    expect(changed).toHaveBeenCalled();
    off();
    changed.mockClear();
    act(() => {
      editor.dispatch({ label: "Nudge", ops: [{ op: "move", refs: ["flag"], by: [1, 0] }] });
    });
    expect(changed).not.toHaveBeenCalled();
  });
});

describe("editedSinceText", () => {
  it("is null before the first version and with no newer edit", () => {
    expect(editedSinceText([], null)).toBeNull();
    expect(editedSinceText([], { name: "hall@1", at: 0 })).toBeNull();
  });
});

describe("the toolbar's Publish scene entry", () => {
  function toolbar(live?: EditorLiveHost) {
    const registry = createRegistry();
    const session = createEditorSession({
      doc: sceneToDoc(
        { v: SCENE_FORMAT_VERSION, name: "yard", bounds: [0, 0, 10, 10], entities: [] },
        { key: sequentialKeys("y") },
      ),
      origin: jo,
      name: "yard",
      registry,
    });
    sessions.push(session);
    render(
      <EditorToolbar
        session={session}
        keymap={createKeymap([])}
        host={null}
        onPlay={() => {}}
        onPlayHere={() => {}}
        project={{ session: null } as unknown as EditorProjectLink}
        {...(live ? { live } : {})}
      />,
    );
  }

  it("is there with the host's live publishing, with its hint", async () => {
    toolbar({ role: () => ({ publisher: false }) } as unknown as EditorLiveHost);
    const button = screen.getByRole("button", { name: "Publish scene" });
    fireEvent.focus(button);
    expect(await screen.findByText(PUBLISH_SCENE_TOOLTIP)).toBeTruthy();
  });

  it("isn't there without host.publish.live", () => {
    toolbar();
    expect(screen.queryByRole("button", { name: "Publish scene" })).toBeNull();
  });

  it("has an icon of its own, not the Publish panel's", () => {
    expect(PUBLISH_SCENE_ICON).not.toBe(PUBLISH_PANEL.icon);
  });
});
