// @vitest-environment node
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { HocuspocusProvider } from "@hocuspocus/provider";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as Y from "yjs";

import { prefabToDoc } from "../../collab/prefab-doc";
import { readProject, writeEntry } from "../../collab/project-doc";
import { docNameOf } from "../../project/doc-names";
import type { ProjectOp } from "../../project/ops";
import type { AssetEntry } from "../../project/types";
import { formatPrefab } from "../../scene/format";
import type { Prefab } from "../../scene/types";
import { applyProjectBatchToFiles } from "../apply-files";
import { listenSceneCollab, type ListeningSceneCollab } from "../collab-server";
import { createProjectFileAdapter } from "../project-files";
import { connect, engineProjectCopy, pushed, until, type ProjectCopy } from "./dev-server-fixture";

let copy: ProjectCopy;

beforeEach(async () => {
  copy = await engineProjectCopy(["kitchen-sink.json", "prefabs/post.json", "prefabs/gate.json"]);
});

afterEach(() => copy.remove());

async function loaded() {
  const adapter = createProjectFileAdapter(copy.project);
  const doc = new Y.Doc();
  await adapter.loadProject(doc);
  return { adapter, doc };
}

const put = async (path: string, text: string) => {
  await mkdir(dirname(copy.file(path)), { recursive: true });
  await writeFile(copy.file(path), text);
};

const prefab = (id: string, path: string): AssetEntry => ({
  key: id,
  id,
  kind: "prefab",
  path,
  created: { at: 0, by: "test" },
});

const PEG: Prefab = {
  kind: "prefab",
  v: 2,
  id: "peg",
  entities: [{ id: "top", type: "marker", at: [0, -40] }],
};

const entryOf = (doc: Y.Doc, id: string) =>
  Object.values(readProject(doc).assets).find((e) => e.id === id)!;

/** Every file under the copy, as project-relative paths. */
async function listed(): Promise<string[]> {
  const names = await readdir(copy.dir, { recursive: true, withFileTypes: true });
  return names
    .filter((d) => d.isFile())
    .map((d) => `${d.parentPath}/${d.name}`.slice(copy.dir.length + 1).replaceAll("\\", "/"))
    .sort();
}

/** A new `peg` prefab entry at `path`, its doc loaded and seeded the way a session creates one. */
async function newPeg(
  adapter: ReturnType<typeof createProjectFileAdapter>,
  doc: Y.Doc,
  path: string,
) {
  const entry = prefab("peg", path);
  writeEntry(doc, entry);
  const name = adapter.docNameOf(entry);
  const pegDoc = new Y.Doc();
  await adapter.loadDoc(name, pegDoc);
  prefabToDoc(PEG, { doc: pegDoc, project: copy.project.file.id, assetKey: "peg" });
  return { name, pegDoc };
}

describe("blockedWrite", () => {
  it("is null when every new and moved entry's path is free", async () => {
    const { adapter, doc } = await loaded();
    writeEntry(doc, prefab("peg", "prefabs/peg.json"));
    const post = Object.values(readProject(doc).assets).find((e) => e.id === "post")!;
    writeEntry(doc, { ...post, path: "kit/post.json" });
    expect(await adapter.blockedWrite(doc)).toBeNull();
  });

  it("refuses a new entry over a file the scan doesn't list", async () => {
    await put("prefabs/peg.json", "{ not json");
    const { adapter, doc } = await loaded();
    expect(await adapter.blockedWrite(doc)).toBeNull();
    writeEntry(doc, prefab("peg", "prefabs/peg.json"));
    expect(await adapter.blockedWrite(doc)).toMatchObject({
      code: "path-taken",
      entityIds: ["peg"],
      got: "prefabs/peg.json",
    });
  });

  it("folds case, and refuses a file where a folder goes", async () => {
    await put("prefabs/Peg.json", "{ not json");
    await put("kit", "a file");
    const { adapter, doc } = await loaded();
    writeEntry(doc, prefab("peg", "prefabs/peg.json"));
    expect((await adapter.blockedWrite(doc))?.message).toMatch(/prefabs\/Peg\.json/);
    writeEntry(doc, prefab("peg", "kit/peg.json"));
    expect((await adapter.blockedWrite(doc))?.message).toMatch(/blocked by "kit"/);
  });

  it("lets a move take its own file's path in another case", async () => {
    const { adapter, doc } = await loaded();
    const post = Object.values(readProject(doc).assets).find((e) => e.id === "post")!;
    writeEntry(doc, { ...post, path: "prefabs/Post.json" });
    expect(await adapter.blockedWrite(doc)).toBeNull();
  });
});

describe("storeProject and storeDoc on held paths", () => {
  it("skips a create and a move under a file the scan doesn't list, strands nothing, and writes them once it's gone", async () => {
    await put("stuff", "a file");
    const { adapter, doc } = await loaded();
    const gateText = await copy.read("prefabs/gate.json");
    const postText = await copy.read("prefabs/post.json");
    const { name, pegDoc } = await newPeg(adapter, doc, "stuff/peg.json");
    writeEntry(doc, { ...entryOf(doc, "post"), path: "stuff/post.json" });
    writeEntry(doc, { ...entryOf(doc, "gate"), path: "kit/gate.json" });

    expect(await adapter.storeDoc(name, pegDoc)).toBe(false);
    expect(await adapter.storeProject(doc)).toBe(true);
    expect(await copy.read("stuff")).toBe("a file");
    expect(await copy.read("kit/gate.json")).toBe(gateText);
    const files = await listed();
    expect(files.filter((f) => f.endsWith(".move") || f.endsWith(".tmp"))).toEqual([]);
    expect(files).toContain("prefabs/post.json");
    expect(files).not.toContain("prefabs/gate.json");

    await rm(copy.file("stuff"));
    expect(await adapter.storeProject(doc)).toBe(true);
    expect(await copy.read("stuff/post.json")).toBe(postText);
    expect(await copy.read("stuff/peg.json")).toBe(formatPrefab(PEG));
    expect(await adapter.storeDoc(name, pegDoc)).toBe(false);
    expect(await adapter.blockedWrite(doc)).toBeNull();
  });

  it("doesn't write a new file beside one that differs only in case", async () => {
    await put("prefabs/Peg.json", "{ not json");
    const { adapter, doc } = await loaded();
    const { name, pegDoc } = await newPeg(adapter, doc, "prefabs/peg.json");
    expect(await adapter.storeDoc(name, pegDoc)).toBe(false);
    expect(await adapter.storeProject(doc)).toBe(false);
    const prefabs = (await listed()).filter((f) => f.startsWith("prefabs/"));
    expect(prefabs).toEqual(["prefabs/Peg.json", "prefabs/gate.json", "prefabs/post.json"]);
    expect(await copy.read("prefabs/Peg.json")).toBe("{ not json");
  });

  it("holds a move onto a path that only a held move would free", async () => {
    await put("stuff", "a file");
    const { adapter, doc } = await loaded();
    const gateText = await copy.read("prefabs/gate.json");
    const postText = await copy.read("prefabs/post.json");
    writeEntry(doc, { ...entryOf(doc, "gate"), path: "stuff/gate.json" });
    writeEntry(doc, { ...entryOf(doc, "post"), path: "prefabs/gate.json" });
    expect(await adapter.blockedWrite(doc)).toMatchObject({ code: "path-taken" });
    expect(await adapter.storeProject(doc)).toBe(false);
    expect(await copy.read("prefabs/gate.json")).toBe(gateText);
    expect(await copy.read("prefabs/post.json")).toBe(postText);
    expect((await listed()).filter((f) => f.endsWith(".move"))).toEqual([]);
  });
});

describe("file batches and blocked paths", () => {
  const agent = { kind: "agent", agentId: "cli" } as const;
  const apply = (ops: ProjectOp[], dryRun = false) =>
    applyProjectBatchToFiles(copy.project, { v: 1, ops }, { origin: agent, dryRun });
  const rubber = { kind: "material", v: 1, description: "Bouncy." };

  it("refuses a create blocked by a file the scan doesn't list, dry run or not, and writes nothing", async () => {
    await put("stuff", "a file");
    const before = await copy.read("kitchen-sink.json");
    for (const dryRun of [true, false]) {
      const result = await apply(
        [{ op: "createAsset", kind: "material", path: "stuff/rubber.json", content: rubber }],
        dryRun,
      );
      expect(result).toMatchObject({
        ok: false,
        opIndex: 0,
        issue: { code: "path-taken", got: "stuff/rubber.json" },
      });
    }
    expect(await copy.read("stuff")).toBe("a file");
    expect(await copy.read("kitchen-sink.json")).toBe(before);
    const { state } = await createProjectFileAdapter(copy.project).scan();
    expect(Object.values(state.assets).map((e) => e.path)).not.toContain("stuff/rubber.json");
  });

  it("writes a create at the path a trash in the same batch frees", async () => {
    const made = await apply([
      {
        op: "createAsset",
        kind: "material",
        id: "old",
        path: "materials/rubber.json",
        content: rubber,
      },
    ]);
    expect(made.ok, JSON.stringify(made)).toBe(true);
    const fresh = { ...rubber, description: "Fresh." };
    const swapped = await apply([
      { op: "deleteAsset", id: "old" },
      {
        op: "createAsset",
        kind: "material",
        id: "new",
        path: "materials/rubber.json",
        content: fresh,
      },
    ]);
    expect(swapped.ok, JSON.stringify(swapped)).toBe(true);
    expect(JSON.parse(await copy.read("materials/rubber.json"))).toMatchObject(fresh);
    const { state } = await createProjectFileAdapter(copy.project).scan();
    const live = Object.values(state.assets).filter((e) => e.path === "materials/rubber.json");
    expect(live.map((e) => e.id)).toEqual(["new"]);
  });
});

describe("the dev server's blocked writes", () => {
  const clients: HocuspocusProvider[] = [];
  let server: ListeningSceneCollab | undefined;
  afterEach(async () => {
    for (const c of clients.splice(0)) c.destroy();
    await server?.close();
  });

  it("warns once about a live entry whose path a file outside the registry holds, and leaves it unwritten", async () => {
    await put("stuff", "a file");
    const warnings: string[] = [];
    server = await listenSceneCollab({
      projects: [copy.project],
      debounceMs: 50,
      watchDelayMs: 20,
      warn: (m) => warnings.push(m),
    });
    const { doc, provider } = await connect(
      server.url,
      docNameOf({ kind: "project", project: copy.project.file.id }),
      clients,
    );
    const blocked = (): string[] => warnings.filter((w) => w.includes("path-taken"));
    writeEntry(doc, prefab("peg", "stuff/peg.json"));
    await pushed(provider);
    await until(() => blocked().length > 0, "the path-taken warning");
    expect(blocked()[0]).toMatch(/blocked by "stuff"/);
    writeEntry(doc, { ...prefab("peg", "stuff/peg.json"), name: "Peg" });
    await pushed(provider);
    await server.idle();
    expect(blocked()).toHaveLength(1);
    expect(await copy.read("stuff")).toBe("a file");
  });

  it("stores a blocked prefab doc without writing or throwing, and writes it once the path frees", async () => {
    await put("stuff", "a file");
    const errors = vi.spyOn(console, "error");
    try {
      const warnings: string[] = [];
      server = await listenSceneCollab({
        projects: [copy.project],
        debounceMs: 50,
        watchDelayMs: 20,
        warn: (m) => warnings.push(m),
      });
      const project = await connect(
        server.url,
        docNameOf({ kind: "project", project: copy.project.file.id }),
        clients,
      );
      const post = entryOf(project.doc, "post");
      const postText = await copy.read("prefabs/post.json");
      writeEntry(project.doc, prefab("peg", "stuff/peg.json"));
      writeEntry(project.doc, { ...post, path: "stuff/post.json" });
      await pushed(project.provider);
      const peg = await connect(
        server.url,
        docNameOf({ kind: "asset", project: copy.project.file.id, key: "peg" }),
        clients,
      );
      prefabToDoc(PEG, { doc: peg.doc, project: copy.project.file.id, assetKey: "peg" });
      await pushed(peg.provider);
      await until(() => warnings.some((w) => w.includes("path-taken")), "the path-taken warning");
      await server.idle();
      expect(await copy.read("stuff")).toBe("a file");
      expect(await copy.read("prefabs/post.json")).toBe(postText);
      expect((await listed()).filter((f) => f.endsWith(".move") || f.endsWith(".tmp"))).toEqual([]);

      await rm(copy.file("stuff"));
      writeEntry(project.doc, { ...prefab("peg", "stuff/peg.json"), name: "Peg" });
      await pushed(project.provider);
      await until(async () => {
        const files = await listed();
        return files.includes("stuff/peg.json") && files.includes("stuff/post.json");
      }, "the new and moved files once the path frees");
      await server.idle();
      expect(await copy.read("stuff/peg.json")).toBe(formatPrefab(PEG));
      expect(await copy.read("stuff/post.json")).toBe(postText);
      expect(errors.mock.calls.flat().map(String)).not.toContainEqual(
        expect.stringMatching(/storeDocumentHooks/),
      );
    } finally {
      errors.mockRestore();
    }
  });
});
