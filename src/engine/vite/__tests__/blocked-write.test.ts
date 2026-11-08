// @vitest-environment node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { readProject, writeEntry } from "../../collab/project-doc";
import type { AssetEntry } from "../../project/types";
import { createProjectFileAdapter } from "../project-files";
import { engineProjectCopy, type ProjectCopy } from "./dev-server-fixture";

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
