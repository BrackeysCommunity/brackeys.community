// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { memoryContentStore } from "../../project/content-store";
import { sha256 } from "../../project/hash";
import { createKindRegistry } from "../../project/kinds";
import { ENGINE_ASSET_KINDS } from "../../project/kinds/index";
import { handleProjectRequest, type ProjectRequest, type ProjectSource } from "../handler";
import type { FileProject } from "../project-files";

function source(id: string, blobKinds = true): ProjectSource {
  const kinds = createKindRegistry(
    null,
    blobKinds ? ENGINE_ASSET_KINDS : ENGINE_ASSET_KINDS.filter((def) => def.storage !== "blob"),
  );
  const project = { dir: "/nowhere", file: { id, name: id }, kinds } as unknown as FileProject;
  return {
    project,
    state: () => Promise.reject(new Error("unused")),
    store: memoryContentStore(),
  };
}

function post(url: string, bytes: Uint8Array): ProjectRequest {
  return {
    method: "POST",
    url,
    headers: {},
    body: async (limit) => (bytes.byteLength > limit ? null : bytes),
  };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe("the dev server's blob upload", () => {
  it("refuses an upload to a project with no blob kinds as asset-kind, before reading it", async () => {
    let read = false;
    const request: ProjectRequest = {
      ...post("/__project/plain/blob", PNG),
      body: async () => {
        read = true;
        return PNG;
      },
    };
    const res = await handleProjectRequest(request, [source("plain", false)]);
    expect(res?.status).toBe(400);
    expect(res?.body).toMatchObject({
      error: "This project defines no blob kinds.",
      issue: { code: "asset-kind" },
    });
    expect(read).toBe(false);
  });

  it("decodes the project id segment as the site's route does", async () => {
    const res = await handleProjectRequest(post("/__project/a%2Db/blob", PNG), [source("a-b")]);
    expect(res).toMatchObject({ status: 200, body: { sha256: await sha256(PNG) } });
  });

  it("answers 404 for a malformed id escape", async () => {
    const res = await handleProjectRequest(post("/__project/%E0%A4%A/blob", PNG), [source("a")]);
    expect(res?.status).toBe(404);
  });

  it("keeps hash-mismatch at 422", async () => {
    const res = await handleProjectRequest(
      { ...post("/__project/a/blob", PNG), headers: { "x-expect-sha256": "ab".repeat(32) } },
      [source("a")],
    );
    expect(res?.status).toBe(422);
    expect(res?.body).toMatchObject({ issue: { code: "hash-mismatch" } });
  });
});

describe("the project routes' CORS", () => {
  const from = (origin: string, method: string, url: string): ProjectRequest => ({
    method,
    url,
    headers: { host: "localhost:5173", origin },
    body: async () => PNG,
  });

  it("answers a preflight from a loopback origin, as Vite's default allows", async () => {
    const res = await handleProjectRequest(
      from("http://localhost:3000", "OPTIONS", "/__project/a/blob"),
      [source("a")],
    );
    expect(res?.status).toBe(204);
    expect(res?.headers).toMatchObject({
      "access-control-allow-origin": "http://localhost:3000",
      vary: "Origin",
    });
    const allowed = res?.headers?.["access-control-allow-headers"]?.split(/,\s*/);
    expect(allowed).toEqual(expect.arrayContaining(["content-type", "x-expect-sha256"]));
  });

  it("refuses a preflight from another origin, with no CORS headers", async () => {
    const res = await handleProjectRequest(
      from("https://elsewhere.example", "OPTIONS", "/__project/a/blob"),
      [source("a")],
    );
    expect(res?.status).toBe(403);
    expect(Object.keys(res?.headers ?? {}).filter((k) => k.startsWith("access-control"))).toEqual(
      [],
    );
  });

  it("puts the header on a blob GET and a POST from an allowed origin", async () => {
    const a = source("a");
    const hash = await a.store.put(PNG);
    const origin = "http://127.0.0.1:4000";
    const got = await handleProjectRequest(from(origin, "GET", `/__project/a/blob/${hash}`), [a]);
    expect(got?.status).toBe(200);
    expect(got?.headers).toMatchObject({
      "access-control-allow-origin": origin,
      vary: "Origin",
      "content-type": "application/octet-stream",
    });
    const posted = await handleProjectRequest(from(origin, "POST", "/__project/a/blob"), [a]);
    expect(posted).toMatchObject({
      status: 200,
      headers: { "access-control-allow-origin": origin },
      body: { sha256: hash },
    });
  });

  it("follows the dev server's own cors setting", async () => {
    const origin = "https://editor.example";
    const req = from(origin, "GET", "/__project");
    const allowed = await handleProjectRequest(req, [source("a")], { cors: { origin: [origin] } });
    expect(allowed?.headers?.["access-control-allow-origin"]).toBe(origin);
    const off = await handleProjectRequest(
      from("http://localhost:3000", "GET", "/__project"),
      [source("a")],
      { cors: false },
    );
    expect(off?.status).toBe(403);
  });

  it("adds no CORS headers to a same-origin request", async () => {
    const res = await handleProjectRequest(from("http://localhost:5173", "GET", "/__project"), [
      source("a"),
    ]);
    expect(res?.status).toBe(200);
    expect(res?.headers?.["access-control-allow-origin"]).toBeUndefined();
  });
});
