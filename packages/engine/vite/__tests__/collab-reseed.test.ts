// @vitest-environment node
import { rm } from "node:fs/promises";
import { join } from "node:path";

import * as provider from "@hocuspocus/provider";
import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { applyOpsToDoc } from "../../collab/apply";
import { docToScene, entitiesMap } from "../../collab/convert";
import { SEED_STALE_REASON } from "../../collab/seed-identity";
import type { SceneOrigin } from "../../collab/types";
import { hocuspocusTransport } from "../../editor-ui/connect/hocuspocus";
import { connectProjectSession } from "../../editor-ui/connect/project-session";
import type { HocuspocusModule } from "../../editor-ui/host";
import { docNameOf } from "../../project/doc-names";
import { createKindRegistry } from "../../project/kinds";
import { formatScene } from "../../scene/format";
import { listenSceneCollab, type ListeningSceneCollab } from "../collab-server";
import { connect, engineProjectCopy, until, type ProjectCopy } from "./dev-server-fixture";

const YARD = docNameOf({ kind: "scene", project: "engine", key: "engine-yard" });
const ada: SceneOrigin = { kind: "user", userId: "ada" };
const FAST = { delay: 30, factor: 1, minDelay: 30, maxDelay: 60, jitter: false } as const;

let copy: ProjectCopy;
let server: ListeningSceneCollab | null = null;
let port = 0;
const providers: HocuspocusProvider[] = [];
const sockets: HocuspocusProviderWebsocket[] = [];
const cleanup: (() => void)[] = [];
const warnings: string[] = [];

const text = (doc: Y.Doc) => formatScene(docToScene(doc)).text;
const disk = () => copy.read("engine-yard.json");
const serverDoc = () => server?.server.hocuspocus.documents.get(YARD);

async function startServer(): Promise<void> {
  server = await listenSceneCollab({
    projects: [copy.project],
    port,
    debounceMs: 30,
    watchDelayMs: 20,
    settleMs: 100,
    warn: (m) => warnings.push(m),
  });
  port = server.port;
}

/** Restarts the server with its cache gone, so every doc is seeded afresh from the files. */
async function reseed(): Promise<void> {
  await server?.close();
  server = null;
  await rm(join(copy.cacheDir, "docs"), { recursive: true, force: true });
  await startServer();
}

beforeEach(async () => {
  warnings.length = 0;
  port = 0;
  copy = await engineProjectCopy(["engine-yard.json"]);
  await startServer();
});

afterEach(async () => {
  for (const c of cleanup.splice(0)) c();
  for (const p of providers.splice(0)) p.destroy();
  for (const s of sockets.splice(0)) s.destroy();
  await server?.close();
  server = null;
  await copy.remove();
});

describe("a client holding a doc across a reseed of the dev server", () => {
  it("is refused before its history merges into the new seed", async () => {
    const doc = new Y.Doc();
    const socket = new HocuspocusProviderWebsocket({ url: server!.url, ...FAST });
    sockets.push(socket);
    const closes: string[] = [];
    const client = new HocuspocusProvider({
      websocketProvider: socket,
      name: YARD,
      document: doc,
      onClose: ({ event }) => void closes.push(event.reason),
    });
    client.attach();
    providers.push(client);
    await until(() => client.synced, "the first sync");
    const original = await disk();
    const records = entitiesMap(doc).size;

    await server!.close();
    server = null;
    await rm(join(copy.cacheDir, "docs"), { recursive: true, force: true });
    // An edit made while the server was down rides on the old seed too.
    const added = applyOpsToDoc(
      doc,
      { ops: [{ op: "add", entity: { id: "flag", type: "marker", at: [5, 5] } }] },
      ada,
      copy.project.registry,
    );
    if (!added.ok) throw new Error(added.issue.message);
    await startServer();

    await until(() => closes.includes(SEED_STALE_REASON), "the stale client's refusal");
    expect(
      warnings.some((w) => w.includes(`${YARD}: the client's copy came from another seed`)),
    ).toBe(true);
    await server!.idle();
    expect(await disk()).toBe(original);
    // The refused copy left nothing behind: a new client gets the new seed alone.
    const fresh = await connect(server!.url, YARD, providers);
    expect(entitiesMap(fresh.doc).size).toBe(records);
    expect(text(fresh.doc)).toBe(original);
    expect(docToScene(fresh.doc).entities!.some((e) => e.id === "flag")).toBe(false);
  });

  // Each restart closes the docs under an open socket, and the session re-attaches them after its first 2 s backoff.
  it("resets an editor's project session to the server's state, which a reconnect keeps", async () => {
    const mod = {
      ...provider,
      HocuspocusProviderWebsocket: class extends HocuspocusProviderWebsocket {
        constructor(config: ConstructorParameters<typeof HocuspocusProviderWebsocket>[0]) {
          super({ ...config, ...FAST });
        }
      },
    } as unknown as HocuspocusModule;
    const link = connectProjectSession({
      project: "engine",
      registry: copy.project.registry,
      kinds: createKindRegistry(copy.project.registry.game),
      origin: ada,
      transport: hocuspocusTransport(mod),
      url: server!.url,
    });
    cleanup.push(() => link.destroy());
    await until(() => link.getState().status === "live", "the session");
    const first = link.getState().session!;
    const before = await first.open(YARD);
    const records = entitiesMap(before.doc).size;
    const original = await disk();

    await reseed();
    await until(() => {
      const state = link.getState();
      return state.session !== null && state.session !== first && state.status === "live";
    }, "a fresh session");
    expect(warnings.some((w) => w.includes("came from another seed"))).toBe(true);
    const second = link.getState().session!;
    const after = await second.open(YARD);
    const fresh = serverDoc()!;
    expect(entitiesMap(after.doc).size).toBe(records);
    expect(entitiesMap(fresh).size).toBe(records);
    expect(text(after.doc)).toBe(original);
    expect(Y.encodeStateVector(after.doc)).toEqual(Y.encodeStateVector(fresh));

    // A plain restart keeps the seed (it's persisted with the doc): the session stays.
    warnings.length = 0;
    await server!.close();
    server = null;
    await startServer();
    await until(() => serverDoc() !== undefined, "the reconnect");
    await new Promise((r) => setTimeout(r, 200));
    expect(link.getState().session).toBe(second);
    expect(warnings).toEqual([]);
    expect(entitiesMap(serverDoc()!).size).toBe(records);
  }, 20_000);
});
