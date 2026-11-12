// @vitest-environment jsdom

import { Store } from "@tanstack/store";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { sceneToDoc, sequentialKeys, type SceneOrigin } from "../../collab/index";
import { createEditorSession } from "../../editor/index";
import { createRegistry } from "../../game/index";
import { EditorFrame, editorChrome } from "../frame/EditorFrame";
import type { EditorNotify, EditorPublishHost } from "../host";
import { DEFAULT_LAYOUT } from "../layout/model";
import { LAYOUT_KEY } from "../layout/use-layout";
import type { EditorHostState } from "../session/live-scene-editor";
import type { EditorChromeGame, EditorProjectLink } from "../session/use-scene-editor";

const settingsProps = vi.hoisted(() => [] as { publish?: unknown }[]);
vi.mock("../panels/settings/ProjectSettings", () => ({
  ProjectSettings: (props: { publish?: unknown }) => {
    settingsProps.push(props);
    return <div role="region" aria-label="Project settings" />;
  },
}));

vi.mock("../panels/EditorProject", () => ({
  EditorProject: () => <div role="tree" aria-label="Project files" />,
  useSelectedAsset: () => null,
}));

const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };

const notify: EditorNotify = Object.assign(vi.fn(), {
  error: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
});

function publishHost(): EditorPublishHost {
  return {
    project: "p-1" as EditorPublishHost["project"],
    usage: vi.fn(async () => ({ lines: [], notice: null, trash: null, footer: "" })),
    releases: vi.fn(async () => []),
    promote: vi.fn(),
    rollback: vi.fn(),
    settings: vi.fn(async () => ({
      visibility: "private" as const,
      reviewPending: false,
      saveMode: "site" as const,
      connectOrigins: [],
      online: false,
      team: null,
    })),
    setSettings: vi.fn(),
    openTokenDialog: vi.fn(),
    wording: {
      command: "vp run scene game release create p-1",
      noRelease: "Run this:",
      token: "",
      visibility: { private: "Private", team: "Team", unlisted: "Unlisted", public: "Public" },
      saveModes: { site: "Site", own: "Own", none: "Nowhere" },
      connectsTo: "",
      connectOriginsMax: 4,
      privateLinks: "",
    },
  };
}

function chromeFor(publish?: EditorPublishHost) {
  const registry = createRegistry();
  const session = createEditorSession({
    doc: sceneToDoc(
      { v: 1, name: "yard", bounds: [0, 0, 400, 300], entities: [] },
      { key: sequentialKeys("t") },
    ),
    origin: ada,
    name: "yard",
    registry,
  });
  const game = {
    registry,
    pointerWorld: () => null,
    getStore: () => new Store({}),
  } as unknown as EditorChromeGame;
  const project = { session: {} } as unknown as EditorProjectLink;
  return editorChrome(
    {
      session,
      host: new Store<EditorHostState>({ connection: "live", sceneChanged: false }),
      game,
      notify,
      project,
      onPlay: vi.fn(),
      onReplay: vi.fn(),
      onStop: vi.fn(),
      onRestart: vi.fn(),
    },
    publish ? { publish } : {},
  );
}

function mount(publish?: EditorPublishHost, storage = new Map<string, string>()) {
  const chrome = chromeFor(publish);
  render(
    <EditorFrame
      host={{ storage: { get: (k) => storage.get(k) ?? null, set: (k, v) => storage.set(k, v) } }}
      panels={chrome.panels}
    >
      <canvas />
    </EditorFrame>,
  );
  return chrome;
}

const tabs = (group: string) =>
  within(screen.getByRole("tablist", { name: group }))
    .getAllByRole("tab")
    .map((t) => t.querySelector(".je-tab-label")?.textContent);

afterEach(() => {
  cleanup();
  settingsProps.length = 0;
});

describe("the editor's publishing entry", () => {
  it("adds the Publish tab beside the project's panels and hands settings the host", async () => {
    const releases = vi.fn(async () => []);
    const publish = { ...publishHost(), releases };
    const chrome = mount(publish);
    expect(chrome.panels?.defs?.map((d) => d.id)).toContain("publish");
    expect(chrome.panels?.context.controls.publish).toBe(publish);
    expect(tabs("Left column, bottom group")).toEqual(["Project", "Project settings", "Publish"]);

    fireEvent.click(screen.getByRole("tab", { name: /Project settings/ }));
    await waitFor(() => expect(settingsProps.at(-1)?.publish).toBe(publish));

    fireEvent.click(screen.getByRole("tab", { name: /Publish/ }));
    expect(await screen.findByText("vp run scene game release create p-1")).toBeTruthy();
    expect(releases).toHaveBeenCalled();
  });

  it("has no Publish tab and no publishing settings for a host that doesn't publish", async () => {
    const chrome = mount();
    expect(chrome.panels?.defs?.map((d) => d.id)).not.toContain("publish");
    expect(screen.queryByRole("tab", { name: /Publish/ })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /Project settings/ }));
    await waitFor(() => expect(settingsProps.length).toBeGreaterThan(0));
    expect(settingsProps.at(-1)?.publish).toBeUndefined();
  });

  it("puts Publish in its home group in a layout stored before it existed", () => {
    const storage = new Map([[LAYOUT_KEY, JSON.stringify(DEFAULT_LAYOUT)]]);
    mount(publishHost(), storage);
    expect(tabs("Left column, bottom group")).toEqual(["Project", "Project settings", "Publish"]);
  });
});
