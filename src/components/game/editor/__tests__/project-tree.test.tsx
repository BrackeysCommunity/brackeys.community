// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  applyProjectBatch,
  createProjectSession,
  memoryDocHost,
  sceneToDoc,
  seedProjectDoc,
  sequentialKeys,
  setProjectPresence,
  type MemoryDocHost,
  type ProjectSession,
  type SceneOrigin,
} from "@jams/engine/collab";
import { createEditorSession, type EditorSession, type SceneDefinition } from "@jams/engine/editor";
import { createRegistry } from "@jams/engine/game";
import {
  createKindRegistry,
  memoryContentStore,
  type AssetEntry,
  type AssetKey,
  type ProjectState,
} from "@jams/engine/project";
import { SCENE_FORMAT_VERSION } from "@jams/engine/scene";
import { Store } from "@tanstack/store";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { EditorInspector } from "@/components/game/editor/EditorInspector";
import {
  EditorProject,
  useSelectedAsset,
  type EditorProjectLink,
} from "@/components/game/editor/EditorProject";
import { useEditorStore } from "@/components/game/editor/use-editor-store";
import { blobContentStore, type ProjectBlobs } from "@/components/game/project-blobs";

const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/lib/toast", () => ({ toast: Object.assign(toast, toasts) }));

const registry = createRegistry();
const kinds = createKindRegistry(null);
const ada: SceneOrigin = { kind: "user", userId: "ada", name: "Ada" };
const bo: SceneOrigin = { kind: "user", userId: "bo", name: "Bo" };
const PROJECT = "yard";
const SCENE_DOC = `scene:${PROJECT}.klevel`;

const entry = (key: string, path: string, kind: string, extra: Partial<AssetEntry> = {}) => {
  const id = path.slice(path.lastIndexOf("/") + 1).replace(/\..*$/, "");
  return { key, id, kind, path, created: { at: 1, by: "seed" }, ...extra } satisfies AssetEntry;
};

function state(): ProjectState {
  const assets = [
    entry("klevel", "scenes/level-1.json", "scene"),
    entry("khero", "sprites/hero.png", "texture", {
      sha256: "a".repeat(64),
      bytes: 120,
      meta: { width: 16, height: 16 },
    }),
    entry("ksheet", "sprites/hero.atlas.json", "atlas", {
      id: "hero-sheet",
      sha256: "b".repeat(64),
      bytes: 80,
      import: { texture: "hero" },
    }),
    entry("kjump", "sfx/jump.ogg", "audio", {
      sha256: "c".repeat(64),
      bytes: 40,
      licence: { spdx: "CC0-1.0", author: "Ana" },
    }),
    entry("kgone", "sprites/old.png", "texture", {
      sha256: "d".repeat(64),
      bytes: 10,
      deleted: { at: Date.now() - 60_000, by: "ada" },
    }),
  ];
  return {
    meta: { projectId: PROJECT, layout: 1, name: "Yard" },
    assets: Object.fromEntries(assets.map((a) => [a.key, a])),
    history: {},
    code: { "src/game.ts": { registers: { types: ["crate", "door"] } } },
    build: {},
  };
}

function scene(): SceneDefinition {
  return {
    v: SCENE_FORMAT_VERSION,
    name: "level-1",
    bounds: [0, 0, 1000, 600],
    entities: [{ id: "pad", type: "marker", at: [100, 500] }],
  };
}

/** A PNG's signature and IHDR chunk: all the texture kind reads. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes;
}

/** The blob route as a test double over an in-memory content store. */
function fakeBlobs(): ProjectBlobs & { uploads: { kind?: string; bytes: number }[] } {
  const store = memoryContentStore();
  const uploads: { kind?: string; bytes: number }[] = [];
  return {
    uploads,
    async upload(bytes, opts = {}) {
      uploads.push({ ...(opts.kind ? { kind: opts.kind } : {}), bytes: bytes.byteLength });
      return { sha256: await store.put(bytes), bytes: bytes.byteLength };
    },
    read: (hash) => store.get(hash),
  };
}

type Setup = {
  host: MemoryDocHost;
  session: ProjectSession;
  blobs: ReturnType<typeof fakeBlobs>;
  picked: Store<AssetKey | null>;
  /** Another client of the same project. */
  other: () => Promise<ProjectSession>;
};

const sessions: ProjectSession[] = [];

async function open(host: MemoryDocHost, origin: SceneOrigin, blobs?: ProjectBlobs) {
  const session = await createProjectSession({
    project: PROJECT,
    openDoc: host.client().openDoc,
    origin,
    registry,
    kinds,
    ...(blobs ? { store: blobContentStore(blobs) } : {}),
  });
  sessions.push(session);
  return session;
}

const editors = new Map<ProjectSession, EditorSession>();

/** The tree and the inspector as the editor's shell joins them. */
function Panels({ link, picked }: { link: EditorProjectLink; picked: Store<AssetKey | null> }) {
  const editor = editors.get(link.session)!;
  const selection = useEditorStore(editor, (s) => s.selection);
  const asset = useSelectedAsset(link, picked, selection);
  return (
    <>
      <EditorProject project={link} selected={picked} />
      <EditorInspector session={editor} {...(asset ? { asset } : {})} />
    </>
  );
}

async function setup(opts: { readOnly?: boolean } = {}): Promise<Setup> {
  const host = memoryDocHost();
  seedProjectDoc(host.doc(`project:${PROJECT}`), state(), { kind: "migration" });
  sceneToDoc(scene(), { doc: host.doc(SCENE_DOC), key: sequentialKeys("s") });
  const blobs = fakeBlobs();
  const session = await open(host, ada, blobs);
  const { doc } = await session.open(SCENE_DOC);
  editors.set(session, createEditorSession({ doc, origin: ada, name: "level-1", registry }));
  const picked = new Store<AssetKey | null>(null);
  const link: EditorProjectLink = {
    session,
    doc: SCENE_DOC,
    blobs,
    ...(opts.readOnly ? { readOnly: true } : {}),
  };
  render(<Panels link={link} picked={picked} />);
  return { host, session, blobs, picked, other: () => open(host, bo) };
}

const files = () => within(screen.getByRole("list", { name: "Files" }));
const rowOf = (name: string) => files().getByText(name).closest("li")!;
const assetOf = (session: ProjectSession, key: string) => session.state().assets[key]!;

/** jsdom lays nothing out: each row gets a 20px band by its place in the list, for dnd-kit. */
const ROW_PX = 20;
beforeAll(() => {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const li = this.closest("li");
    const i = li ? [...(li.parentElement?.children ?? [])].indexOf(li) : -1;
    return DOMRect.fromRect(i < 0 ? {} : { x: 0, y: i * ROW_PX, width: 200, height: ROW_PX });
  });
  // jsdom's Blob reads only through FileReader.
  const read = (blob: Blob, as: "buffer" | "text") =>
    new Promise<ArrayBuffer | string>((done, fail) => {
      const reader = new FileReader();
      reader.onload = () => done(reader.result as ArrayBuffer | string);
      reader.onerror = () => fail(reader.error);
      if (as === "buffer") reader.readAsArrayBuffer(blob);
      else reader.readAsText(blob);
    });
  for (const [name, as] of [
    ["arrayBuffer", "buffer"],
    ["text", "text"],
  ] as const) {
    if (name in Blob.prototype) continue;
    Object.defineProperty(Blob.prototype, name, {
      configurable: true,
      value(this: Blob) {
        return read(this, as);
      },
    });
  }
});
afterAll(() => vi.restoreAllMocks());
afterEach(() => {
  cleanup();
  for (const s of sessions.splice(0)) s.destroy();
  for (const e of editors.values()) e.destroy();
  editors.clear();
  toast.mockReset();
  for (const fn of Object.values(toasts)) fn.mockReset();
});

async function drag(from: HTMLElement, to: HTMLElement) {
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const at = (r: DOMRect) => ({ clientX: r.x + 50, clientY: r.y + r.height / 2 });
  await act(async () => {
    fireEvent.pointerDown(from, { ...at(a), button: 0, isPrimary: true, pointerId: 1 });
  });
  await act(async () => {
    fireEvent.pointerMove(document, { clientX: a.x + 50, clientY: a.y + 30, pointerId: 1 });
  });
  await act(async () => {
    fireEvent.pointerMove(document, { ...at(b), pointerId: 1 });
  });
  await act(async () => {
    fireEvent.pointerUp(document, { ...at(b), pointerId: 1 });
  });
  await act(() => new Promise((done) => setTimeout(done, 60)));
}

async function dropFiles(target: Element, list: File[]) {
  const dataTransfer = { types: ["Files"], files: list, dropEffect: "none" };
  await act(async () => {
    fireEvent.dragEnter(target, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
  });
}

describe("the editor's project tree", () => {
  it("renders the registry: folders, assets with kind icons, greyed code, the trash", async () => {
    await setup();
    const names = files()
      .getAllByRole("listitem")
      .map((li) => li.textContent?.replace(/\d+$/, ""));
    expect(names).toEqual([
      "Yard",
      "scenes",
      "level-1.json",
      "sfx",
      "jump.ogg",
      "sprites",
      "hero.atlas.json",
      "hero.png",
      "src",
      "game.ts",
    ]);
    expect(rowOf("hero.png").dataset.kind).toBe("texture");
    expect(rowOf("hero.atlas.json").dataset.kind).toBe("atlas");
    expect(rowOf("hero.png").querySelector("svg")).not.toBeNull();
    const code = rowOf("game.ts");
    expect(code.dataset.kind).toBe("code");
    expect(within(code).queryByRole("button")).toBeNull();
    expect(code.querySelector("[aria-disabled=true]")).not.toBeNull();

    const trash = within(screen.getByRole("region", { name: "Trash" }));
    fireEvent.click(trash.getByRole("button", { name: /Trash/ }));
    expect(trash.getByText("old.png")).toBeTruthy();
  });

  it("renames in place as a renameAsset, and shows the new name", async () => {
    const { session } = await setup();
    fireEvent.keyDown(files().getByRole("button", { name: /^hero\.png/ }), { key: "F2" });
    const input = files().getByLabelText("File name");
    fireEvent.change(input, { target: { value: "player.png" } });
    await act(async () => fireEvent.keyDown(input, { key: "Enter" }));
    await waitFor(() => expect(assetOf(session, "khero").path).toBe("sprites/player.png"));
    expect(assetOf(session, "khero").id).toBe("hero");
    expect(files().getByText("player.png")).toBeTruthy();
  });

  it("drags an asset to another folder as a moveAsset", async () => {
    const { session } = await setup();
    await drag(
      files().getByRole("button", { name: /^jump\.ogg/ }),
      files().getByRole("button", { name: /^sprites/ }),
    );
    await waitFor(() => expect(assetOf(session, "kjump").path).toBe("sprites/jump.ogg"));
    await drag(files().getByRole("button", { name: /^jump\.ogg/ }), rowOf("Yard"));
    await waitFor(() => expect(assetOf(session, "kjump").path).toBe("jump.ogg"));
  });

  it("moves an unreferenced asset to the trash through the confirm", async () => {
    const { session } = await setup();
    fireEvent.click(files().getByRole("button", { name: "Delete jump.ogg" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Move jump.ogg to the trash?");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Move to trash" }));
    });
    await waitFor(() => expect(assetOf(session, "kjump").deleted?.by).toBe("ada"));
    expect(files().queryByText("jump.ogg")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("lists the referrers a delete is refused for, and deletes anyway with force", async () => {
    const { session } = await setup();
    fireEvent.click(files().getByRole("button", { name: "Delete hero.png" }));
    let dialog = await screen.findByRole("alertdialog");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Move to trash" }));
    });
    dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog.textContent).toContain("hero.png is in use"));
    const used = within(within(dialog).getByRole("list", { name: "Used by" })).getAllByRole(
      "listitem",
    );
    expect(used.map((li) => li.textContent)).toEqual(["hero-sheet/import/texture"]);
    expect(assetOf(session, "khero").deleted).toBeUndefined();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete anyway" }));
    });
    await waitFor(() => expect(assetOf(session, "khero").deleted).toBeDefined());
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("restores from the trash", async () => {
    const { session } = await setup();
    const trash = within(screen.getByRole("region", { name: "Trash" }));
    fireEvent.click(trash.getByRole("button", { name: /Trash/ }));
    await act(async () => {
      fireEvent.click(trash.getByRole("button", { name: "Restore old.png" }));
    });
    await waitFor(() => expect(assetOf(session, "kgone").deleted).toBeUndefined());
    expect(files().getByText("old.png")).toBeTruthy();
  });

  it("imports dropped files: uploads, then one importAsset batch, skipping what it can't take", async () => {
    const { session, blobs } = await setup();
    const coin = new File([png(4, 2) as BlobPart], "coin.png", { type: "image/png" });
    const again = new File([png(8, 8) as BlobPart], "hero.png", { type: "image/png" });
    const notes = new File(["hello"], "notes.xyz");
    await dropFiles(files().getByRole("button", { name: /^sprites/ }), [coin, again, notes]);

    await waitFor(() => expect(session.view().byPath.get("sprites/coin.png")).toBeDefined());
    const made = session.view().byPath.get("sprites/coin.png")!;
    expect(made).toMatchObject({ id: "coin", kind: "texture", bytes: 33 });
    expect(made.meta).toMatchObject({ width: 4, height: 2 });
    expect(session.view().byPath.get("sprites/hero-2.png")).toMatchObject({ id: "hero-2" });
    expect(blobs.uploads).toEqual([
      { kind: "texture", bytes: 33 },
      { kind: "texture", bytes: 33 },
    ]);
    expect(toasts.success).toHaveBeenCalledWith("Imported 2 files");
    expect(toasts.error).toHaveBeenCalledWith("Couldn't import notes.xyz", {
      description: "It isn't a kind of file this project takes.",
    });
    expect(files().getByText("coin.png")).toBeTruthy();
  });

  it("imports a dropped Aseprite JSON as an atlas, told by its meta.app, cutting the texture beside it", async () => {
    const { session, blobs } = await setup();
    const text = readFileSync(resolve("src/engine/project/__tests__/fixtures/hero.json"), "utf8");
    const sheet = new File([text], "hero.json", { type: "application/json" });
    await dropFiles(files().getByRole("button", { name: /^sprites/ }), [sheet]);

    await waitFor(() => expect(session.view().byPath.get("sprites/hero.json")).toBeDefined());
    const made = session.view().byPath.get("sprites/hero.json")!;
    expect(made).toMatchObject({ kind: "atlas", import: { texture: "hero" } });
    expect(made.meta).toMatchObject({ tool: "aseprite" });
    expect(blobs.uploads).toEqual([
      { kind: "atlas", bytes: new TextEncoder().encode(text).length },
    ]);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("shows each peer on the row of the doc they're in, following them", async () => {
    const { other } = await setup();
    const peer = await other();
    act(() =>
      setProjectPresence(peer.awareness, {
        user: { id: "bo", name: "Bo", color: "#0af" },
        doc: SCENE_DOC,
        mode: "edit",
      }),
    );
    await waitFor(() =>
      expect(within(rowOf("level-1.json")).getByRole("img", { name: "Open by Bo" })).toBeTruthy(),
    );
    expect(within(rowOf("hero.png")).queryByRole("img")).toBeNull();

    act(() => setProjectPresence(peer.awareness, { doc: `asset:${PROJECT}.kjump` }));
    await waitFor(() =>
      expect(within(rowOf("jump.ogg")).getByRole("img", { name: "Open by Bo" })).toBeTruthy(),
    );
    expect(within(rowOf("level-1.json")).queryByRole("img")).toBeNull();

    act(() => setProjectPresence(peer.awareness, { doc: null }));
    await waitFor(() =>
      expect(within(rowOf("Yard")).getByRole("img", { name: "On the overview: Bo" })).toBeTruthy(),
    );
  });

  it("shows a texture another tab imports, with that tab's presence on its row", async () => {
    const { host, session } = await setup();
    const theirBlobs = fakeBlobs();
    const peer = await open(host, bo, theirBlobs);
    const { sha256, bytes } = await theirBlobs.upload(png(4, 2), { kind: "texture" });
    const result = await act(() =>
      applyProjectBatch(
        peer,
        {
          v: 1,
          label: "Import coin",
          ops: [{ op: "importAsset", path: "sprites/coin.png", sha256, bytes }],
        },
        peer.origin,
      ),
    );
    expect(result.ok).toBe(true);
    await waitFor(() => expect(files().getByText("coin.png")).toBeTruthy());
    const coin = session.view().byPath.get("sprites/coin.png")!;
    expect(coin).toMatchObject({ id: "coin", kind: "texture", sha256 });

    act(() =>
      setProjectPresence(peer.awareness, {
        user: { id: "bo", name: "Bo", color: "#0af" },
        doc: `asset:${PROJECT}.${coin.key}`,
        mode: "edit",
      }),
    );
    await waitFor(() =>
      expect(within(rowOf("coin.png")).getByRole("img", { name: "Open by Bo" })).toBeTruthy(),
    );
  });

  it("follows another client's changes and announces an agent's and the disk's", async () => {
    const { host } = await setup();
    const agentSession = await open(host, { kind: "agent", agentId: "claude", onBehalfOf: "ada" });
    const result = await act(() =>
      applyProjectBatch(
        agentSession,
        { v: 1, label: "Rename jump", ops: [{ op: "renameAsset", id: "jump", file: "hop.ogg" }] },
        agentSession.origin,
      ),
    );
    expect(result.ok).toBe(true);
    await waitFor(() => expect(files().getByText("hop.ogg")).toBeTruthy());
    expect(toast).toHaveBeenCalledWith("claude for ada changed the project", {
      description: "Rename jump",
    });

    const disk = await open(host, { kind: "disk" });
    await act(() =>
      applyProjectBatch(
        disk,
        { v: 1, label: "Move hop", ops: [{ op: "moveAsset", ids: ["jump"], to: "" }] },
        disk.origin,
      ),
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith("The project's files changed on disk", {
        description: "Move hop",
      }),
    );
    expect(toast).toHaveBeenCalledTimes(2);
  });

  it("shows a picked asset's licence in the inspector and writes it with setLicence", async () => {
    const { session } = await setup();
    expect(screen.queryByRole("region", { name: "Licence" })).toBeNull();
    fireEvent.click(files().getByRole("button", { name: /^jump\.ogg/ }));
    const licence = within(await screen.findByRole("region", { name: "Licence" }));
    expect(licence.getByLabelText<HTMLInputElement>("Author").value).toBe("Ana");
    const author = licence.getByLabelText("Author");
    fireEvent.change(author, { target: { value: "Bo" } });
    await act(async () => fireEvent.keyDown(author, { key: "Enter" }));
    await waitFor(() =>
      expect(assetOf(session, "kjump").licence).toEqual({ spdx: "CC0-1.0", author: "Bo" }),
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Close the asset" })));
    expect(screen.queryByRole("region", { name: "Licence" })).toBeNull();

    // Picking something in the scene takes the inspector back from the asset.
    fireEvent.click(files().getByRole("button", { name: /^hero\.png/ }));
    expect(await screen.findByRole("region", { name: "Licence" })).toBeTruthy();
    act(() => editors.get(session)!.select(["pad"]));
    expect(screen.queryByRole("region", { name: "Licence" })).toBeNull();
    expect(screen.getByLabelText("Inspector").textContent).toContain("pad");
  });

  it("takes no edits when read-only", async () => {
    await setup({ readOnly: true });
    expect(files().queryByRole("button", { name: /^Delete / })).toBeNull();
    expect(files().queryByRole("button", { name: /^Rename / })).toBeNull();
    fireEvent.click(files().getByRole("button", { name: /^jump\.ogg/ }));
    const licence = within(await screen.findByRole("region", { name: "Licence" }));
    expect(licence.getByLabelText<HTMLInputElement>("Author").readOnly).toBe(true);
  });
});
