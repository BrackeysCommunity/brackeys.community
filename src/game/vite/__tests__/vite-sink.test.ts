// @vitest-environment node
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { formatScene } from "../../scene/format";
import { parseSceneOrThrow } from "../../scene/parse";
import testYard from "../../scenes/test-yard.json";
import { createFileSceneStore, handleSceneRequest, type SceneStore } from "../handler";
import { sceneDevSink } from "../index";
import { resolveScenePath, ScenePathError, sceneNameOf } from "../scene-paths";

let dir: string;
let store: SceneStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "scene-sink-"));
  store = createFileSceneStore(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const JSON_HEADERS = { "content-type": "application/json" };

async function send(
  method: string,
  url: string,
  body?: string,
  headers: Record<string, string | undefined> = JSON_HEADERS,
) {
  const res = await handleSceneRequest({ method, url, body, headers }, store);
  if (!res) throw new Error(`${url} was not handled`);
  return res;
}
const post = (name: string, body: string) => send("POST", `/__scene/${name}`, body);

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
    expect(await handleSceneRequest({ method: "GET", url: "/__scenery" }, store)).toBeNull();
    expect(await handleSceneRequest({ method: "GET", url: "/game/x" }, store)).toBeNull();
  });

  it("refuses traversal and bad names with 400 and writes nothing", async () => {
    for (const name of ["..%2Fescape", "%2E%2E", "Bad_Name", "a%2Fb", "%E0%A4%A"]) {
      const res = await post(name, JSON.stringify(testYard));
      expect(res.status, name).toBe(400);
    }
    expect(await readdir(dir)).toEqual([]);
    expect(await readdir(join(dir, ".."))).not.toContain("escape.json");
  });

  it("refuses an invalid scene with 422 and its issues", async () => {
    const res = await post(
      "broken",
      JSON.stringify({ ...testYard, solid: [["boks", 0, 0, 1, 1]] }),
    );
    expect(res.status).toBe(422);
    const body = res.body as { issues: { code: string; severity: string }[] };
    expect(body.issues.length).toBeGreaterThan(0);
    expect(body.issues[0]).toMatchObject({ code: "bad-shape", severity: "error" });
    expect(await readdir(dir)).toEqual([]);
  });

  it("refuses structural errors with 422", async () => {
    const dup = { id: "dup", b: "anchor", at: [0, 0] };
    const res = await post("dups", JSON.stringify({ ...testYard, entities: [dup, dup] }));
    expect(res.status).toBe(422);
    expect((res.body as { issues: { code: string }[] }).issues.map((i) => i.code)).toContain(
      "dup-id",
    );
  });

  it("writes the canonical text for a valid scene", async () => {
    const res = await post("yard", JSON.stringify(testYard));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, hash: expect.stringMatching(/^[0-9a-f]{16}$/) });
    const written = await readFile(join(dir, "yard.json"), "utf8");
    expect(written).toBe(formatScene(parseSceneOrThrow(testYard)).text);
  });

  it("refuses a write when the file changed since the base hash", async () => {
    const first = await post("yard", JSON.stringify(testYard));
    const base = (first.body as { hash: string }).hash;
    const edited = { ...testYard, name: "edited" };

    const ok = await send("POST", `/__scene/yard?base=${base}`, JSON.stringify(edited));
    expect(ok.status).toBe(200);

    const stale = await send("POST", `/__scene/yard?base=${base}`, JSON.stringify(testYard));
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ ok: false, expected: base });
    expect(JSON.parse(await readFile(join(dir, "yard.json"), "utf8")).name).toBe("edited");

    expect((await post("yard", JSON.stringify(testYard))).status).toBe(200);
  });

  it.each([
    ["a text/plain body", { "content-type": "text/plain" }, 415],
    ["no content type", {}, 415],
    ["a cross-site fetch", { ...JSON_HEADERS, "sec-fetch-site": "cross-site" }, 403],
    [
      "another origin",
      { ...JSON_HEADERS, origin: "https://evil.example", host: "localhost:3000" },
      403,
    ],
  ])("refuses a write with %s", async (_, headers, status) => {
    const res = await send("POST", "/__scene/yard", JSON.stringify(testYard), headers);
    expect(res.status).toBe(status);
    expect(await readdir(dir)).toEqual([]);
  });

  it("accepts a same-origin write", async () => {
    const headers = {
      ...JSON_HEADERS,
      origin: "http://localhost:3000",
      host: "localhost:3000",
      "sec-fetch-site": "same-origin",
    };
    const res = await send("POST", "/__scene/yard", JSON.stringify(testYard), headers);
    expect(res.status).toBe(200);
  });

  it("lists and reads scenes", async () => {
    await writeFile(join(dir, "a.json"), JSON.stringify(testYard));
    await writeFile(join(dir, "scene.schema.json"), "{}");
    expect((await send("GET", "/__scene")).body).toEqual({ ok: true, scenes: ["a"] });
    expect((await send("GET", "/__scene/a")).body).toEqual(testYard);
    expect((await send("GET", "/__scene/nope")).status).toBe(404);
  });

  it("rejects other methods", async () => {
    expect((await send("DELETE", "/__scene/a")).status).toBe(405);
  });
});

describe("sceneDevSink", () => {
  it("is a serve-only plugin that registers one middleware", () => {
    const plugin = sceneDevSink({ dir });
    expect(plugin.apply).toBe("serve");
    const used: unknown[] = [];
    plugin.configureServer({ middlewares: { use: (fn) => used.push(fn) } });
    expect(used).toHaveLength(1);
  });
});
