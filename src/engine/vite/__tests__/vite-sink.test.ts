// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import engineYard from "../../scenes/engine-yard.json";
import { fileContentStore } from "../content-store";
import {
  handleSceneRequest,
  projectSceneStore,
  type ProjectSource,
  type SceneStore,
} from "../handler";
import { sceneCollabServer } from "../index";
import { createProjectFileAdapter, readFileProject } from "../project-files";
import { resolveScenePath, ScenePathError, sceneNameOf } from "../scene-paths";

let dir: string;
let store: SceneStore;

/** Each directory as a project of its own, read by scanning its files. */
async function storeOver(dirs: string[]): Promise<SceneStore> {
  const sources: ProjectSource[] = [];
  for (const [i, d] of dirs.entries()) {
    await writeFile(
      join(d, "jams.project.json"),
      JSON.stringify({ kind: "project", v: 1, id: `p${i}`, name: "P", game: null }),
    );
    const project = await readFileProject(d, { cacheDir: join(d, "..", `cache-${i}`) });
    const adapter = createProjectFileAdapter(project);
    sources.push({
      project,
      store: fileContentStore(project.cacheDir),
      state: async () => (await adapter.scan()).state,
    });
  }
  return projectSceneStore(sources);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "scene-sink-"));
  store = await storeOver([dir]);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function send(method: string, url: string) {
  const res = await handleSceneRequest({ method, url }, store);
  if (!res) throw new Error(`${url} was not handled`);
  return res;
}
describe("resolveScenePath", () => {
  it("resolves a valid name inside the directory", () => {
    expect(resolveScenePath(dir, "test-yard")).toBe(join(dir, "test-yard.json"));
  });

  it.each(["../escape", "a/b", "..", "", "Upper", "-lead", "x".repeat(49), "a.b", "%2e%2e"])(
    "refuses %j",
    (name) => {
      expect(() => resolveScenePath(dir, name)).toThrow(ScenePathError);
    },
  );

  it("maps file names back to scene names", () => {
    expect(sceneNameOf("test-yard.json")).toBe("test-yard");
    expect(sceneNameOf("scene.schema.json")).toBeNull();
    expect(sceneNameOf("notes.md")).toBeNull();
  });
});

describe("handleSceneRequest", () => {
  it("ignores other URLs", async () => {
    for (const url of ["/__scenery", "/game/x"]) {
      expect(await handleSceneRequest({ method: "GET", url }, store)).toBeNull();
    }
  });

  it("refuses traversal and bad names with 400", async () => {
    for (const name of ["..%2Fescape", "%2E%2E", "Bad_Name", "a%2Fb", "%E0%A4%A"]) {
      expect((await send("GET", `/__scene/${name}`)).status, name).toBe(400);
    }
  });

  it("lists and reads scenes", async () => {
    await writeFile(join(dir, "a.json"), JSON.stringify(engineYard));
    await writeFile(join(dir, "scene.schema.json"), "{}");
    expect((await send("GET", "/__scene")).body).toEqual({ ok: true, scenes: ["a"] });
    expect((await send("GET", "/__scene/a")).body).toEqual(engineYard);
    expect((await send("GET", "/__scene/nope")).status).toBe(404);
  });

  it("lists every project's scenes once and reads from the first that has the scene", async () => {
    const other = await mkdtemp(join(tmpdir(), "scene-sink-"));
    try {
      await writeFile(join(dir, "a.json"), JSON.stringify(engineYard));
      await writeFile(join(other, "a.json"), JSON.stringify(engineYard));
      await writeFile(join(other, "b.json"), JSON.stringify(engineYard));
      store = await storeOver([dir, other]);
      expect((await send("GET", "/__scene")).body).toEqual({ ok: true, scenes: ["a", "b"] });
      expect((await send("GET", "/__scene/a")).body).toEqual(engineYard);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it("refuses writes and every other method: scenes are edited through the collab server", async () => {
    for (const method of ["POST", "PUT", "DELETE"])
      expect((await send(method, "/__scene/a")).status, method).toBe(405);
  });
});

describe("sceneCollabServer", () => {
  it("is a serve-only plugin that registers one middleware and an upgrade listener", () => {
    const plugin = sceneCollabServer({ projects: [] });
    expect(plugin.apply).toBe("serve");
    const used: unknown[] = [];
    const events: string[] = [];
    plugin.configureServer({
      middlewares: { use: (fn) => used.push(fn) },
      httpServer: { on: (event: string) => events.push(event) },
    });
    expect(used).toHaveLength(1);
    expect(events.sort()).toEqual(["close", "upgrade"]);
  });
});
