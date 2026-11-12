// @vitest-environment node
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { applyOpsToDoc } from "../../collab/apply";
import { contentMaps, docToScene, readDoc } from "../../collab/convert";
import { readLog } from "../../collab/log";
import type { SceneOrigin } from "../../collab/types";
import { docNameOf } from "../../project/doc-names";
import { formatScene } from "../../scene/format";
import { applyOps } from "../../scene/ops";
import { parseSceneOrThrow } from "../../scene/parse";
import { listenSceneCollab, type ListeningSceneCollab } from "../collab-server";
import { engineProjectCopy, pushed, until, type ProjectCopy } from "./dev-server-fixture";

const YARD = docNameOf({ kind: "scene", project: "engine", key: "engine-yard" });
const ada: SceneOrigin = { kind: "user", userId: "ada" };

let copy: ProjectCopy;
let server: ListeningSceneCollab | null = null;
let port = 0;
const providers: HocuspocusProvider[] = [];
const sockets: HocuspocusProviderWebsocket[] = [];
const warnings: string[] = [];

const text = (doc: Y.Doc) => formatScene(docToScene(doc)).text;
const disk = () => copy.read("engine-yard.json");
const serverDoc = () => server!.server.hocuspocus.documents.get(YARD);

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

async function stopServer(): Promise<void> {
  await server?.close();
  server = null;
}

/** A client that keeps one doc across drops, reconnecting fast, with an undo manager over this client's edits. */
async function client() {
  const doc = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({
    url: server!.url,
    delay: 30,
    factor: 1,
    minDelay: 30,
    maxDelay: 60,
    jitter: false,
  });
  sockets.push(socket);
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: YARD, document: doc });
  provider.attach();
  providers.push(provider);
  await until(() => provider.synced, "the first sync");
  const undo = new Y.UndoManager(contentMaps(doc), {
    trackedOrigins: new Set([ada]),
    captureTimeout: 0,
  });
  const edit = (ops: Parameters<typeof applyOpsToDoc>[1]["ops"]) => {
    const result = applyOpsToDoc(doc, { ops }, ada, copy.project.registry);
    if (!result.ok) throw new Error(result.issue.message);
    undo.stopCapturing();
  };
  return { doc, provider, undo, edit };
}

const entityKeys = (doc: Y.Doc) => [...readDoc(doc).entityKeys].sort();

beforeEach(async () => {
  warnings.length = 0;
  port = 0;
  copy = await engineProjectCopy(["engine-yard.json"]);
  await startServer();
});

afterEach(async () => {
  for (const p of providers.splice(0)) p.destroy();
  for (const s of sockets.splice(0)) s.destroy();
  await stopServer();
  await copy.remove();
});

describe("dev persistence across a server restart", () => {
  it("keeps edits made while the server was down, with keys and undo stacks intact", async () => {
    const original = await disk();
    const a = await client();
    a.edit([{ op: "move", refs: ["crate"], by: [10, 0] }]);
    await pushed(a.provider);
    await until(async () => (await disk()) === text(a.doc), "the first store");
    const keys = entityKeys(a.doc);

    await stopServer();
    await access(join(copy.cacheDir, "docs", "scene", "engine.engine-yard.bin"));
    a.edit([{ op: "add", entity: { id: "flag", type: "marker", at: [50, 50] } }]);
    const offline = text(a.doc);

    await startServer();
    await until(() => serverDoc() !== undefined && text(serverDoc()!) === offline, "the reconnect");
    await until(async () => (await disk()) === offline, "the offline edit's store");
    expect(entityKeys(serverDoc()!).filter((k) => keys.includes(k))).toEqual(keys);
    expect(docToScene(serverDoc()!).entities!.filter((e) => e.id === "crate")).toHaveLength(1);

    a.undo.undo();
    a.undo.undo();
    expect(text(a.doc)).toBe(original);
    await pushed(a.provider);
    await until(async () => (await disk()) === original, "the undos to reach the file");
    expect(text(serverDoc()!)).toBe(original);
    expect(warnings).toEqual([]);
  });

  it("brings a file edited while the server was down in as one disk transaction", async () => {
    const a = await client();
    a.edit([{ op: "move", refs: ["crate"], by: [10, 0] }]);
    await pushed(a.provider);
    await until(async () => (await disk()) === text(a.doc), "the first store");

    await stopServer();
    const def = parseSceneOrThrow(await disk(), copy.project.registry);
    const edited = applyOps(
      def,
      { ops: [{ op: "update", ref: "lift", set: { "path.speed": 40 } }] },
      copy.project.registry,
    );
    if (!edited.ok) throw new Error(edited.issue.message);
    await writeFile(copy.file("engine-yard.json"), `${JSON.stringify(edited.def, null, 2)}\n`);

    await startServer();
    await until(
      () => serverDoc() !== undefined && text(a.doc) === formatScene(edited.def).text,
      "the reconnect to bring the file's change",
    );
    const fromDisk = readLog(serverDoc()!).filter((e) => e.actor.kind === "disk");
    expect(fromDisk.map((e) => e.label)).toEqual(["Changed on disk"]);
    expect(readLog(a.doc).map((e) => e.actor.kind)).toEqual(["user", "disk"]);

    a.undo.undo();
    await pushed(a.provider);
    await until(
      async () =>
        (await disk()) === text(a.doc) &&
        docToScene(a.doc).entities!.find((e) => e.id === "lift") !== undefined,
      "the undo's store",
    );
    const lift = docToScene(a.doc).entities!.find((e) => e.id === "lift") as {
      path?: { speed?: number };
    };
    expect(lift.path?.speed).toBe(40);
    expect(warnings).toEqual([]);
  });
});
