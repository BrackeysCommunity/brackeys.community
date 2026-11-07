// @vitest-environment node
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { applyOpsToDoc } from "../../collab/apply";
import { docPrefabs, docToScene } from "../../collab/convert";
import { readLog } from "../../collab/log";
import { createRegistry } from "../../game/define";
import { formatPrefab, formatScene } from "../../scene/format";
import { parseSceneOrThrow } from "../../scene/parse";
import type { Prefab } from "../../scene/types";
import {
  createSceneFileAdapter,
  sceneDocName,
  sceneOfDocName,
  type SceneFileAdapter,
} from "../file-adapter";

const ENGINE = createRegistry();
const YARD = fileURLToPath(new URL("../../scenes/engine-yard.json", import.meta.url));
const user = { kind: "user", userId: "ada" } as const;

let root: string;
let dir: string;
let file: string;
let adapter: SceneFileAdapter;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "scene-adapter-"));
  dir = join(root, "a");
  await mkdir(dir);
  file = join(dir, "engine-yard.json");
  await copyFile(YARD, file);
  adapter = createSceneFileAdapter([{ dir, registry: ENGINE }]);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const text = (doc: Y.Doc) => formatScene(docToScene(doc)).text;

async function loaded() {
  const doc = new Y.Doc();
  await adapter.load("engine-yard", doc);
  return doc;
}

describe("scene document names", () => {
  it("round-trip scene names and refuse anything else", () => {
    expect(sceneDocName("engine-yard")).toBe("scene:engine-yard");
    expect(sceneOfDocName("scene:engine-yard")).toBe("engine-yard");
    for (const bad of ["canvas:x", "scene:", "scene:../x", "scene:Bad", "engine-yard"])
      expect(sceneOfDocName(bad), bad).toBeNull();
  });
});

describe("createSceneFileAdapter", () => {
  it("seeds a doc from the file with no log entry", async () => {
    const doc = await loaded();
    expect(text(doc)).toBe(await readFile(file, "utf8"));
    expect(readLog(doc)).toEqual([]);
    expect(await adapter.list()).toEqual(["engine-yard"]);
  });

  it("refuses a missing scene, a name in two homes, and a file that doesn't parse", async () => {
    await expect(adapter.load("nope", new Y.Doc())).rejects.toThrow(/No scene named/);
    const other = join(root, "b");
    await mkdir(other);
    await copyFile(YARD, join(other, "engine-yard.json"));
    const both = createSceneFileAdapter([
      { dir, registry: ENGINE },
      { dir: other, registry: ENGINE },
    ]);
    await expect(both.load("engine-yard", new Y.Doc())).rejects.toThrow(/more than one/);
    await writeFile(file, "{ not json");
    await expect(adapter.load("engine-yard", new Y.Doc())).rejects.toThrow(/doesn't parse/);
  });

  it("stores canonical text only when it changed", async () => {
    const doc = await loaded();
    expect(await adapter.store("engine-yard", doc)).toBe(false);
    applyOpsToDoc(doc, { ops: [{ op: "setScene", set: { name: "moved" } }] }, user, ENGINE);
    expect(await adapter.store("engine-yard", doc)).toBe(true);
    expect(await readFile(file, "utf8")).toBe(text(doc));
    expect(await adapter.store("engine-yard", doc)).toBe(false);
  });

  it("ignores its own writes when the file changes", async () => {
    const doc = await loaded();
    applyOpsToDoc(doc, { ops: [{ op: "setScene", set: { name: "moved" } }] }, user, ENGINE);
    await adapter.store("engine-yard", doc);
    expect(await adapter.sync("engine-yard", doc)).toEqual({ kind: "unchanged" });
  });

  it("applies an outside change as one disk transaction with a log entry", async () => {
    const doc = await loaded();
    const def = parseSceneOrThrow(await readFile(file, "utf8"), ENGINE);
    def.entities = def.entities!.filter((e) => e.id !== "readme");
    await writeFile(file, JSON.stringify(def));

    const origins: unknown[] = [];
    doc.on("afterTransaction", (tr: Y.Transaction) => origins.push(tr.origin));
    expect(await adapter.sync("engine-yard", doc)).toEqual({ kind: "applied", ops: 1 });
    expect(origins).toEqual([{ kind: "disk" }]);
    expect(readLog(doc).map((e) => [e.actor, e.label])).toEqual([
      [{ kind: "disk" }, "Changed on disk"],
    ]);
    expect(text(doc)).toBe(formatScene(def).text);

    expect(await adapter.store("engine-yard", doc)).toBe(true);
    expect(await readFile(file, "utf8")).toBe(formatScene(def).text);
  });

  it("keeps the doc when the file stops parsing, and a reformat alone changes nothing", async () => {
    const doc = await loaded();
    const before = text(doc);
    await writeFile(file, "{ half an edit");
    const refused = await adapter.sync("engine-yard", doc);
    expect(refused.kind).toBe("refused");
    expect(text(doc)).toBe(before);

    await writeFile(file, JSON.stringify(JSON.parse(before)));
    expect(await adapter.sync("engine-yard", doc)).toEqual({ kind: "unchanged" });
    expect(readLog(doc)).toEqual([]);
  });

  it("refuses an outside change no op can make", async () => {
    const doc = await loaded();
    const def = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify({ ...def, v: 3 }));
    expect((await adapter.sync("engine-yard", doc)).kind).toBe("refused");
  });
});

describe("prefab files", () => {
  const POST: Prefab = {
    kind: "prefab",
    v: 2,
    id: "post",
    entities: [{ id: "top", type: "marker", at: [0, -40] }],
  };
  const prefabFile = () => join(dir, "prefabs", "post.json");

  beforeEach(async () => {
    await mkdir(join(dir, "prefabs"));
    await writeFile(prefabFile(), formatPrefab(POST));
  });

  it("seeds the doc with its home's prefabs", async () => {
    const doc = await loaded();
    expect([...docPrefabs(doc).keys()]).toEqual(["post"]);
  });

  it("writes an Apply to prefab back to the prefab's file in the same store", async () => {
    const doc = await loaded();
    const r = applyOpsToDoc(
      doc,
      {
        ops: [
          { op: "instantiate", instance: { id: "post-1", prefab: "post", at: [500, 900] } },
          { op: "override", ref: "post-1", set: { "top.at": [0, -60] } },
          { op: "applyToPrefab", ref: "post-1" },
        ],
      },
      user,
      ENGINE,
    );
    expect(r.ok).toBe(true);
    expect(await adapter.store("engine-yard", doc)).toBe(true);
    const written = JSON.parse(await readFile(prefabFile(), "utf8")) as Prefab;
    expect(written.entities[0]!.at).toEqual([0, -60]);
    expect(await adapter.sync("engine-yard", doc)).toEqual({ kind: "unchanged" });
  });

  it("brings a prefab file changed on disk into the doc as one disk transaction", async () => {
    const doc = await loaded();
    await writeFile(
      prefabFile(),
      formatPrefab({ ...POST, entities: [{ id: "top", type: "marker", at: [0, -90] }] }),
    );
    expect(await adapter.sync("engine-yard", doc)).toEqual({ kind: "applied", ops: 1 });
    expect(docPrefabs(doc).get("post")!.entities[0]!.at).toEqual([0, -90]);
    expect(readLog(doc).at(-1)!.actor).toEqual({ kind: "disk" });
  });
});
