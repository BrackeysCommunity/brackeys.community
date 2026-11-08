// @vitest-environment node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { HocuspocusProvider } from "@hocuspocus/provider";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { readProject, writeEntry } from "../../collab/project-doc";
import { docNameOf } from "../../project/doc-names";
import type { ProjectOp } from "../../project/ops";
import type { AssetEntry } from "../../project/types";
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
});
