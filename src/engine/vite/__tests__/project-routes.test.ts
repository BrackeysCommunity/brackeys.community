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
