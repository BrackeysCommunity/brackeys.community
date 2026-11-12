// @vitest-environment jsdom

import { Store } from "@tanstack/store";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createProjectSession,
  memoryDocHost,
  seedProjectDoc,
  type ProjectSession,
} from "../../collab/index";
import { createRegistry } from "../../game/index";
import {
  createKindRegistry,
  memoryContentStore,
  type AssetKey,
  type ProjectState,
  type Sha256,
} from "../../project/index";
import { blobContentStore, projectBlobs } from "../connect/blobs";
import { Activity } from "../frame/Activity";
import type { EditorNotify, ProjectBlobs, UploadedBlob } from "../host";
import { KitProvider } from "../kit/index";
import { EditorProject } from "../panels/EditorProject";
import { hero, jump, PROJECT, tree } from "../panels/project-tree/__tests__/fixtures";
import { LicenceFields } from "../panels/project-tree/licence-fields";
import { ProjectTree } from "../panels/project-tree/project-tree";
import { createPending, type Pending } from "../pending/pending";
import { PendingProvider } from "../pending/use-pending";

const toasts = { error: vi.fn(), success: vi.fn(), warning: vi.fn() };
const notify: EditorNotify = Object.assign(vi.fn(), toasts);
const sessions: ProjectSession[] = [];

afterEach(() => {
  cleanup();
  localStorage.clear();
  for (const s of sessions.splice(0)) s.destroy();
  for (const fn of Object.values(toasts)) fn.mockReset();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A blob route whose uploads wait until the test lets each one through or refuses it. */
function deferredBlobs() {
  const store = memoryContentStore();
  const waiting: { bytes: Uint8Array; answer: ReturnType<typeof deferred<UploadedBlob>> }[] = [];
  const blobs: ProjectBlobs = {
    upload(bytes, opts = {}) {
      opts.onProgress?.(0, bytes.byteLength);
      const answer = deferred<UploadedBlob>();
      waiting.push({ bytes, answer });
      return answer.promise;
    },
    read: (hash: Sha256) => store.get(hash),
  };
  const next = async () => {
    await waitFor(() => expect(waiting.length).toBeGreaterThan(0));
    return waiting.shift()!;
  };
  return {
    blobs,
    async accept() {
      const { bytes, answer } = await next();
      const sha256 = await store.put(bytes);
      await act(async () => answer.resolve({ sha256, bytes: bytes.byteLength }));
    },
    async refuse(message: string) {
      const { answer } = await next();
      await act(async () => answer.reject(new Error(message)));
    },
  };
}

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

const pngFile = (name: string, size: number) => {
  const bytes = png(size, size);
  return Object.assign(new File([bytes as BlobPart], name, { type: "image/png" }), {
    arrayBuffer: async () => bytes.buffer,
  });
};

function state(): ProjectState {
  return {
    meta: { projectId: PROJECT, layout: 1, name: "Yard" },
    assets: {
      klevel: {
        key: "klevel",
        id: "level-1",
        kind: "scene",
        path: "scenes/level-1.json",
        created: { at: 1, by: "seed" },
      },
    },
    history: {},
    code: { "src/game.ts": { registers: { types: ["crate"] } } },
    build: {},
  };
}

/** Every activity shows at once: the clock is far past each task's start. */
const later = () => Date.now() + 60_000;

async function editorProject() {
  const host = memoryDocHost();
  seedProjectDoc(host.doc(`project:${PROJECT}`), state(), { kind: "migration" });
  const route = deferredBlobs();
  const session = await createProjectSession({
    project: PROJECT,
    openDoc: host.client().openDoc,
    origin: { kind: "user", userId: "ada", name: "Ada" },
    registry: createRegistry(),
    kinds: createKindRegistry(null),
    store: blobContentStore(route.blobs),
  });
  sessions.push(session);
  const pending = createPending({ notify });
  const seen: { done: number; total: number }[] = [];
  pending.store.subscribe(() => {
    const progress = pending.store.state.tasks.find((t) => t.progress)?.progress;
    if (progress && seen.at(-1)?.done !== progress.done) seen.push(progress);
  });
  render(
    <KitProvider host={{}}>
      <PendingProvider pending={pending}>
        <Activity now={later} />
        <EditorProject
          project={{ session, doc: `scene:${PROJECT}.klevel`, blobs: route.blobs }}
          selected={new Store<AssetKey | null>(null)}
          notify={notify}
        />
      </PendingProvider>
    </KitProvider>,
  );
  return { session, route, pending, seen };
}

const files = () => within(screen.getByRole("list", { name: "Files" }));
const folderRow = (name: RegExp) => files().getByRole("button", { name }).closest("li")!;
const activity = () => document.querySelector<HTMLElement>(".je-activity")!;

async function dropOn(target: Element, list: File[]) {
  const dataTransfer = { types: ["Files"], files: list, dropEffect: "none" };
  await act(async () => {
    fireEvent.dragEnter(target, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
  });
}

describe("importing dropped files", () => {
  it("keeps the drop target and folder busy, counts files, and says so once", async () => {
    const { session, route, seen } = await editorProject();
    await dropOn(folderRow(/^scenes/), [
      pngFile("a.png", 2),
      pngFile("b.png", 4),
      pngFile("c.png", 8),
    ]);

    const target = screen.getByTestId("project-drop-target");
    expect(target.getAttribute("aria-busy")).toBe("true");
    expect(folderRow(/^scenes/).getAttribute("aria-busy")).toBe("true");
    await waitFor(() => expect(activity().textContent).toContain("Uploading a.png"));
    expect(activity().textContent).toContain("0 of 3");

    await route.accept();
    await waitFor(() => expect(activity().textContent).toContain("1 of 3"));
    expect(within(folderRow(/^scenes/)).getByText("1 of 3")).toBeTruthy();
    expect(target.getAttribute("aria-busy")).toBe("true");

    await route.accept();
    await route.accept();
    await waitFor(() => expect(session.view().byPath.get("scenes/c.png")).toBeDefined());
    expect(seen.map((p) => `${p.done} of ${p.total}`)).toEqual([
      "0 of 3",
      "1 of 3",
      "2 of 3",
      "3 of 3",
    ]);
    await waitFor(() => expect(target.getAttribute("aria-busy")).toBeNull());
    expect(folderRow(/^scenes/).getAttribute("aria-busy")).toBeNull();
    expect(toasts.success.mock.calls).toEqual([["Imported 3 files"]]);
    expect(toasts.error).not.toHaveBeenCalled();
    expect(activity().textContent).toBe("");
  });

  it("toasts a refused file once and imports the rest", async () => {
    const { session, route } = await editorProject();
    await dropOn(files().getByText("Yard").closest("li")!, [
      pngFile("a.png", 2),
      pngFile("b.png", 4),
      pngFile("c.png", 8),
    ]);
    await route.accept();
    await route.refuse("quota-exceeded");
    await route.accept();

    await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1));
    expect(toasts.success).toHaveBeenCalledWith("Imported 2 files");
    expect(toasts.error.mock.calls).toEqual([
      ["Couldn't import b.png", { description: "quota-exceeded" }],
    ]);
    expect(session.view().byPath.get("a.png")).toBeDefined();
    expect(session.view().byPath.get("b.png")).toBeUndefined();
    expect(session.view().byPath.get("c.png")).toBeDefined();
  });
});

describe("project ops", () => {
  function tree$(props: Partial<Parameters<typeof ProjectTree>[0]> = {}) {
    const pending: Pending = createPending({ notify });
    render(
      <KitProvider host={{}}>
        <PendingProvider pending={pending}>
          <ProjectTree
            projectId={PROJECT}
            projectName="Yard"
            nodes={tree()}
            notify={notify}
            {...props}
          />
        </PendingProvider>
      </KitProvider>,
    );
    return pending;
  }

  it("shows a renamed row busy until its batch settles", async () => {
    const batch = deferred<void>();
    const onRename = vi.fn(() => batch.promise);
    tree$({ onRename });
    const row = () =>
      files()
        .getByRole("button", { name: /^hero\.png/ })
        .closest("li")!;
    fireEvent.keyDown(files().getByRole("button", { name: /^hero\.png/ }), { key: "F2" });
    fireEvent.change(files().getByLabelText("File name"), { target: { value: "player.png" } });
    await act(async () => fireEvent.keyDown(files().getByLabelText("File name"), { key: "Enter" }));

    expect(onRename).toHaveBeenCalledWith(hero, { file: "player.png" });
    expect(row().getAttribute("aria-busy")).toBe("true");
    expect(within(row()).queryByRole("button", { name: "Rename hero.png" })).toBeNull();
    // A busy row takes no second rename.
    fireEvent.keyDown(files().getByRole("button", { name: /^hero\.png/ }), { key: "F2" });
    expect(files().queryByLabelText("File name")).toBeNull();

    await act(async () => batch.resolve());
    expect(row().getAttribute("aria-busy")).toBeNull();
    expect(within(row()).getByRole("button", { name: "Rename hero.png" })).toBeTruthy();
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("starts code modules under a collapsed Code row, and remembers it opened", () => {
    tree$();
    const code = files().getByRole("button", { name: /^Code/ });
    expect(code.getAttribute("aria-expanded")).toBe("false");
    expect(files().queryByText("game.ts")).toBeNull();
    const rows = files().getAllByRole("listitem");
    expect(rows.at(-1)?.dataset.kind).toBe("code-group");

    fireEvent.click(code);
    expect(files().getByText("game.ts")).toBeTruthy();
    cleanup();
    tree$();
    expect(files().getByRole("button", { name: /^Code/ }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(files().getByText("game.ts")).toBeTruthy();
  });

  it("shows a licence field saving, then its error on refusal", async () => {
    const write = deferred<void>();
    const onLicence = vi.fn(() => write.promise);
    const pending = createPending({ notify });
    render(
      <PendingProvider pending={pending}>
        <LicenceFields entry={jump} onLicence={onLicence} notify={notify} />
      </PendingProvider>,
    );
    const form = within(screen.getByRole("region", { name: "Licence" }));
    const author = form.getByLabelText<HTMLInputElement>("Author");
    fireEvent.change(author, { target: { value: "Bo" } });
    await act(async () => fireEvent.blur(author));

    expect(author.getAttribute("aria-busy")).toBe("true");
    expect(author.closest(".je-licence-field")?.textContent).toContain("Saving…");
    expect(form.getByLabelText("Source").getAttribute("aria-busy")).toBeNull();
    expect(author.value).toBe("Bo");

    await act(async () => write.reject(new Error("read-only kind")));
    expect(author.getAttribute("aria-busy")).toBeNull();
    expect(author.getAttribute("aria-invalid")).toBe("true");
    expect(form.getByRole("alert").textContent).toBe("read-only kind");
    expect(author.value).toBe("Bo");
    expect(toasts.error.mock.calls).toEqual([
      ["Couldn't save the author", { description: "read-only kind" }],
    ]);

    fireEvent.keyDown(author, { key: "Escape" });
    expect(author.value).toBe("Ana");
    expect(form.queryByRole("alert")).toBeNull();
  });
});

describe("the project panel while its doc opens", () => {
  it("shows the tree's skeleton until the project doc holds the server's state", async () => {
    const host = memoryDocHost();
    const session = await createProjectSession({
      project: PROJECT,
      openDoc: host.client().openDoc,
      origin: { kind: "user", userId: "ada", name: "Ada" },
      registry: createRegistry(),
      kinds: createKindRegistry(null),
      store: blobContentStore(deferredBlobs().blobs),
    });
    sessions.push(session);
    render(
      <KitProvider host={{}}>
        <EditorProject
          project={{ session, doc: `scene:${PROJECT}.klevel` }}
          selected={new Store<AssetKey | null>(null)}
          notify={notify}
        />
      </KitProvider>,
    );
    expect(files().getByLabelText("Loading")).toBeTruthy();
    act(() => seedProjectDoc(session.projectDoc, state(), { kind: "migration" }));
    await waitFor(() => expect(files().queryByLabelText("Loading")).toBeNull());
    expect(files().getByText("level-1.json")).toBeTruthy();
  });
});

describe("the blob route's upload progress", () => {
  it("reports the bytes sent as the browser sends them, then the whole once stored", async () => {
    const bytes = new Uint8Array(1000);
    const sha256 = await memoryContentStore().put(bytes);
    const sent: number[] = [];
    class FakeXhr {
      status = 0;
      responseText = "";
      upload: { onprogress: ((e: { loaded: number }) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      headers: Record<string, string> = {};
      open(method: string, url: string) {
        expect([method, url]).toEqual(["POST", "/blobs"]);
      }
      setRequestHeader(name: string, value: string) {
        this.headers[name] = value;
      }
      getResponseHeader() {
        return "application/json";
      }
      send(body: Uint8Array) {
        expect(this.headers["x-expect-sha256"]).toBe(sha256);
        this.upload.onprogress?.({ loaded: 400 });
        this.status = 200;
        this.responseText = JSON.stringify({ sha256, bytes: body.byteLength });
        this.onload?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    try {
      const stored = await projectBlobs("/blobs").upload(bytes, {
        onProgress: (n) => sent.push(n),
      });
      expect(stored).toEqual({ sha256, bytes: 1000 });
      expect(sent).toEqual([0, 400, 1000]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
