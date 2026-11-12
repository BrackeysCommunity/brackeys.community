// @vitest-environment node
import { Server } from "@hocuspocus/server";
import {
  layoutFromDoc,
  layoutToDoc,
  readLog,
  readProjectLog,
  SEED_STALE_CODE,
  SEED_STALE_REASON,
  seedProjectDoc,
} from "@jams/engine/collab";
import { createRegistry } from "@jams/engine/game";
import {
  createKindRegistry,
  defineAssetKind,
  sceneKind,
  type AssetEntry,
  type DocLayout,
  type ProjectState,
} from "@jams/engine/project";
import { SCENE_COLLAB_PATH } from "@jams/engine/vite";
import { afterEach, describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";
import { z } from "zod";

import {
  agentOrigin,
  openProjectClient,
  ProjectClientError,
  seedStaleError,
} from "../project-client";

const cardLayout: DocLayout = { as: "map", rest: { as: "atomic" } };
const card = defineAssetKind({
  storage: "doc",
  kind: "card",
  title: "Card",
  description: "A card.",
  match: { suffixes: [".card.json"] },
  version: 1,
  schemaId: "urn:jams-engine:card:v1",
  schema: () => z.strictObject({ v: z.literal(1), title: z.string().optional() }),
  layout: cardLayout,
  empty: () => ({ v: 1 }),
});
const kinds = createKindRegistry(null, [sceneKind, card]);
const registry = createRegistry();

const cardEntry = (key: string): AssetEntry => ({
  key,
  id: key,
  kind: "card",
  path: `cards/${key}.card.json`,
  created: { at: 0, by: "seed" },
});
const STATE: ProjectState = {
  meta: { projectId: "p", layout: 1, name: "P" },
  assets: { a: cardEntry("a"), b: cardEntry("b") },
  history: {},
  code: {},
  build: {},
};

type Harness = { server: Server; url: string; loaded: string[] };
let running: Harness | null = null;

/** A Hocuspocus server holding project `p` and its two card docs, `asset:p.a` and `asset:p.b`. */
async function serve(opts: { token?: (doc: string) => string } = {}): Promise<Harness> {
  const seeds = new Map<string, Y.Doc>();
  const project = new Y.Doc();
  seedProjectDoc(project, STATE, { kind: "migration" });
  seeds.set("project:p", project);
  for (const key of ["a", "b"]) {
    const doc = new Y.Doc();
    layoutToDoc(doc, cardLayout, { v: 1, title: key });
    seeds.set(`asset:p.${key}`, doc);
  }
  const loaded: string[] = [];
  const server = new Server({
    address: "127.0.0.1",
    port: 0,
    quiet: true,
    stopOnSignals: false,
    ...(opts.token
      ? {
          async onAuthenticate({ token, documentName }) {
            if (token !== opts.token!(documentName)) throw new Error("bad token");
          },
        }
      : {}),
    async onLoadDocument({ documentName, document }) {
      const seed = seeds.get(documentName);
      if (!seed) throw new Error(`no doc named ${documentName}`);
      loaded.push(documentName);
      Y.applyUpdate(document, Y.encodeStateAsUpdate(seed));
    },
  });
  await server.listen();
  running = {
    server,
    url: `ws://127.0.0.1:${server.address.port}${SCENE_COLLAB_PATH}`,
    loaded,
  };
  return running;
}

async function until(check: () => boolean, what: string, ms = 5_000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

const serverDoc = (h: Harness, name: string) => {
  const doc = h.server.hocuspocus.documents.get(name);
  if (!doc) throw new Error(`the server holds no ${name}`);
  return doc;
};

afterEach(async () => {
  await running?.server.destroy();
  running = null;
});

describe("openProjectClient", () => {
  it("opens docs lazily, applies a cross-doc batch as the agent, and closes cleanly", async () => {
    const h = await serve();
    const origin = agentOrigin({ agent: "claude", onBehalfOf: "ada" });
    expect(origin).toEqual({ kind: "agent", agentId: "claude", onBehalfOf: "ada" });

    const client = await openProjectClient({ url: h.url, project: "p", registry, kinds, origin });
    expect(client.opened).toEqual(["project:p"]);
    expect(h.loaded).toEqual(["project:p"]);
    expect(client.session.view().byId.get("b")?.kind).toBe("card");

    const result = await client.apply(
      {
        v: 1,
        label: "Retitle",
        ops: ["a", "b"].map((id) => ({
          op: "editAsset",
          id,
          edits: [{ set: "/title", value: `${id}!` }],
        })),
      },
      { label: "Retitle" },
    );
    if (!result.ok) throw new Error(`${result.issue.code}: ${result.issue.message}`);
    expect(result.docs).toEqual(["asset:p.a", "asset:p.b"]);
    expect(client.opened).toEqual(["project:p", "asset:p.a", "asset:p.b"]);
    expect([...h.loaded].sort()).toEqual(["asset:p.a", "asset:p.b", "project:p"]);

    for (const key of ["a", "b"]) {
      const doc = serverDoc(h, `asset:p.${key}`);
      expect(layoutFromDoc(doc, cardLayout)).toEqual({ v: 1, title: `${key}!` });
      expect(readLog(doc).at(-1)).toMatchObject({ label: "Retitle", actor: origin });
    }
    const entry = readProjectLog(serverDoc(h, "project:p")).at(-1);
    expect(entry).toMatchObject({ label: "Retitle", actor: origin });
    expect(entry).toEqual(result.entry);
    expect(entry?.docs.map((d) => d.doc)).toEqual(["asset:p.a", "asset:p.b"]);

    await client.close();
    await until(() => h.server.hocuspocus.getConnectionsCount() === 0, "the client to disconnect");
    expect(client.session.openDocs()).toEqual([]);
  });

  it("logs the default agent when no actor is given", () => {
    expect(agentOrigin()).toEqual({ kind: "agent", agentId: "scene-cli" });
    expect(agentOrigin({ agent: "", onBehalfOf: "" })).toEqual({
      kind: "agent",
      agentId: "scene-cli",
    });
  });

  it("asks the token hook for each doc it opens, and fails on a refused one", async () => {
    const h = await serve({ token: (doc) => `ok:${doc}` });
    const asked: string[] = [];
    const client = await openProjectClient({
      url: h.url,
      project: "p",
      registry,
      kinds,
      token: (doc) => {
        asked.push(doc);
        return `ok:${doc}`;
      },
    });
    const a = await client.session.open("asset:p.a");
    expect(layoutFromDoc(a.doc, cardLayout)).toEqual({ v: 1, title: "a" });
    expect(asked).toEqual(["project:p", "asset:p.a"]);
    await client.close();

    await expect(
      openProjectClient({
        url: h.url,
        project: "p",
        registry,
        kinds,
        token: () => "nope",
        timeoutMs: 3_000,
      }),
    ).rejects.toThrow(/refused project:p/);
  });

  it("rejects a doc the server can't load and keeps the rest open", async () => {
    const h = await serve();
    const client = await openProjectClient({
      url: h.url,
      project: "p",
      registry,
      kinds,
      timeoutMs: 1_500,
    });
    await expect(client.session.open("asset:p.missing")).rejects.toBeInstanceOf(ProjectClientError);
    const b = await client.session.open("asset:p.b");
    expect(layoutFromDoc(b.doc, cardLayout)).toEqual({ v: 1, title: "b" });
    await client.close();
  });

  it("ends on a seed-stale close after sync: every later call fails, telling the caller to rerun", async () => {
    const h = await serve();
    const client = await openProjectClient({
      url: h.url,
      project: "p",
      registry,
      kinds,
      timeoutMs: 3_000,
    });
    await client.session.open("asset:p.a");
    await until(() => h.server.hocuspocus.getConnectionsCount() > 0, "the client to connect");
    for (const connection of serverDoc(h, "asset:p.a").getConnections())
      connection.close({ code: SEED_STALE_CODE, reason: SEED_STALE_REASON });
    await until(
      () => h.server.hocuspocus.getConnectionsCount() === 0,
      "the client to drop its socket rather than reattach",
    );

    const stale = seedStaleError("asset:p.a");
    expect(stale.message).toMatch(/Run the command again/);
    const batch = {
      v: 1 as const,
      ops: [{ op: "editAsset" as const, id: "b", edits: [{ set: "/title", value: "b!" }] }],
    };
    await expect(client.apply(batch)).rejects.toEqual(stale);
    await expect(client.trial(batch)).rejects.toEqual(stale);
    await expect(client.session.open("asset:p.b")).rejects.toEqual(stale);
    await expect(client.pushed()).rejects.toEqual(stale);
    const closed = await client.close().catch((e: unknown) => e);
    expect(closed).toBeInstanceOf(ProjectClientError);
    expect(closed).toEqual(stale);
    expect(h.loaded).not.toContain("asset:p.b");
  });

  it("fails fast when nothing listens at the url", async () => {
    const h = await serve();
    const url = h.url;
    await h.server.destroy();
    running = null;
    const started = Date.now();
    const error = await openProjectClient({ url, project: "p", registry, kinds }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ProjectClientError);
    expect((error as Error).message).toMatch(/Can't reach the project collab server/);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
