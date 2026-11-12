// @vitest-environment jsdom

import { Store } from "@tanstack/store";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createProjectSession,
  memoryDocHost,
  seedProjectDoc,
  type ProjectSession,
} from "../../../collab/index";
import { createRegistry } from "../../../game/index";
import {
  createKindRegistry,
  memoryContentStore,
  type AssetKey,
  type ProjectState,
} from "../../../project/index";
import { blobContentStore } from "../../connect/blobs";
import type { EditorNotify, ProjectBlobs } from "../../host";
import { KitProvider } from "../../kit/index";
import { EditorProject } from "../EditorProject";

const PROJECT = "yard";
const toasts = { error: vi.fn(), success: vi.fn(), warning: vi.fn() };
const notify: EditorNotify = Object.assign(vi.fn(), toasts);
const cue = vi.fn();
const sessions: ProjectSession[] = [];

function state(): ProjectState {
  const level = {
    key: "klevel",
    id: "level-1",
    kind: "scene",
    path: "scenes/level-1.json",
    created: { at: 1, by: "seed" },
  };
  return {
    meta: { projectId: PROJECT, layout: 1, name: "Yard" },
    assets: { klevel: level },
    history: {},
    code: {},
    build: {},
  };
}

function blobs(): ProjectBlobs {
  const store = memoryContentStore();
  return {
    async upload(bytes) {
      return { sha256: await store.put(bytes), bytes: bytes.byteLength };
    },
    read: (hash) => store.get(hash),
  };
}

async function setup() {
  const host = memoryDocHost();
  seedProjectDoc(host.doc(`project:${PROJECT}`), state(), { kind: "migration" });
  const project = blobs();
  const session = await createProjectSession({
    project: PROJECT,
    openDoc: host.client().openDoc,
    origin: { kind: "user", userId: "ada", name: "Ada" },
    registry: createRegistry(),
    kinds: createKindRegistry(null),
    store: blobContentStore(project),
  });
  sessions.push(session);
  render(
    <KitProvider host={{ cue }}>
      <EditorProject
        project={{ session, doc: `scene:${PROJECT}.klevel`, blobs: project }}
        selected={new Store<AssetKey | null>(null)}
        notify={notify}
      />
    </KitProvider>,
  );
  return session;
}

async function dropOnProject(list: File[]) {
  const target = within(screen.getByRole("list", { name: "Files" }))
    .getByText("Yard")
    .closest("li")!;
  const dataTransfer = { types: ["Files"], files: list, dropEffect: "none" };
  await act(async () => {
    fireEvent.dragEnter(target, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
  });
}

afterEach(() => {
  cleanup();
  for (const s of sessions.splice(0)) s.destroy();
  for (const fn of Object.values(toasts)) fn.mockReset();
  cue.mockReset();
});

describe("dropping desktop files on the project panel", () => {
  it("reports a drop that imports nothing once, with the reasons, and sounds no drop cue", async () => {
    const session = await setup();
    await dropOnProject([new File(["hello"], "notes.xyz"), new File(["hi"], "readme.xyz")]);

    await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1));
    expect(toasts.error).toHaveBeenCalledWith("Couldn't import 2 files", {
      description:
        "notes.xyz: It isn't a kind of file this project takes. readme.xyz: It isn't a kind of file this project takes.",
    });
    expect(toasts.success).not.toHaveBeenCalled();
    expect(cue).not.toHaveBeenCalledWith("drop");
    expect(session.view().byPath.size).toBe(1);
  });

  it("sounds the drop cue when some of the files go in", async () => {
    const session = await setup();
    const ogg = new Uint8Array(27);
    ogg.set(new TextEncoder().encode("OggS"));
    // jsdom's File has no arrayBuffer().
    const jump = Object.assign(new File([ogg], "jump.ogg", { type: "audio/ogg" }), {
      arrayBuffer: async () => ogg.buffer,
    });
    await dropOnProject([jump, new File(["hello"], "notes.xyz")]);

    await waitFor(() => expect(cue).toHaveBeenCalledWith("drop"));
    expect(toasts.success).toHaveBeenCalledWith("Imported jump.ogg");
    expect(toasts.error).toHaveBeenCalledWith("Couldn't import notes.xyz", {
      description: "It isn't a kind of file this project takes.",
    });
    expect(session.view().byPath.get("jump.ogg")).toBeDefined();
  });
});
