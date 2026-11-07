// @vitest-environment node
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { HocuspocusProvider } from "@hocuspocus/provider";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as Y from "yjs";

import { applyOpsToDoc } from "../../collab/apply";
import { docToScene } from "../../collab/convert";
import { readLog } from "../../collab/log";
import type { LogEntry, SceneOrigin } from "../../collab/types";
import { createRegistry } from "../../game/define";
import { formatScene } from "../../scene/format";
import { applyOps } from "../../scene/ops";
import { parseSceneOrThrow } from "../../scene/parse";
import { listenSceneCollab, type ListeningSceneCollab } from "../collab-server";
import { sceneDocName } from "../file-adapter";

const ENGINE = createRegistry();
const YARD = fileURLToPath(new URL("../../scenes/engine-yard.json", import.meta.url));

let dir: string;
let file: string;
let server: ListeningSceneCollab;
const clients: HocuspocusProvider[] = [];
const warnings: string[] = [];

async function until(check: () => boolean | Promise<boolean>, what: string, ms = 5_000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function connect(): Promise<{ doc: Y.Doc; provider: HocuspocusProvider }> {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: server.url,
    name: sceneDocName("engine-yard"),
    document: doc,
  });
  clients.push(provider);
  await until(() => provider.synced, "the first sync");
  return { doc, provider };
}

const pushed = (provider: HocuspocusProvider) =>
  until(() => !provider.hasUnsyncedChanges, "the server to acknowledge the update");

const text = (doc: Y.Doc) => formatScene(docToScene(doc)).text;
const disk = () => readFile(file, "utf8");
const serverDoc = () => server.server.hocuspocus.documents.get(sceneDocName("engine-yard"))!;

/** Every transaction that changes a doc, with the log entries it added. */
function record(doc: Y.Doc) {
  const seen: { local: boolean; entries: LogEntry[] }[] = [];
  doc.on("afterTransaction", (tr: Y.Transaction) => {
    if (tr.changed.size === 0) return;
    const before = seen.reduce((n, s) => n + s.entries.length, 0);
    const log = readLog(doc);
    seen.push({ local: tr.local, entries: log.slice(Math.min(before, log.length)) });
  });
  return seen;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "scene-collab-"));
  file = join(dir, "engine-yard.json");
  await copyFile(YARD, file);
  warnings.length = 0;
  server = await listenSceneCollab({
    homes: [{ dir, registry: ENGINE }],
    debounceMs: 50,
    watchDelayMs: 20,
    warn: (m) => warnings.push(m),
  });
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.destroy();
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

describe("the dev collab server", () => {
  it("seeds a doc from its file and serves the scene list", async () => {
    const { doc } = await connect();
    expect(text(doc)).toBe(await disk());
    const res = await fetch(`${server.httpUrl}/__scene`);
    expect(await res.json()).toEqual({ ok: true, scenes: ["engine-yard"] });
  });

  it("turns a disk edit during a session into one disk transaction, then stores canonical form", async () => {
    const { doc } = await connect();
    const seen = record(doc);
    const def = parseSceneOrThrow(await disk(), ENGINE);
    const edited = applyOps(
      def,
      { ops: [{ op: "update", ref: "lift", set: { "path.speed": 40 } }] },
      ENGINE,
    );
    if (!edited.ok) throw new Error(edited.issue.message);
    // Valid but not canonical, as a hand edit would leave it.
    await writeFile(file, `${JSON.stringify(edited.def, null, 2)}\n`);

    await until(() => seen.length > 0, "the disk change to reach the client");
    await server.idle();
    await until(async () => (await disk()) === formatScene(edited.def).text, "the canonical store");
    await new Promise((r) => setTimeout(r, 150));
    await server.idle();

    expect(seen).toHaveLength(1);
    expect(seen[0]!.local).toBe(false);
    expect(seen[0]!.entries.map((e) => e.actor)).toEqual([{ kind: "disk" }]);
    expect(text(doc)).toBe(formatScene(edited.def).text);
    expect(await disk()).toBe(text(doc));
    expect(warnings).toEqual([]);
  });

  it("converges two clients' edits and leaves the file canonical", async () => {
    const a = await connect();
    const b = await connect();
    const ada: SceneOrigin = { kind: "user", userId: "ada" };
    const bob: SceneOrigin = { kind: "user", userId: "bob" };
    const ra = applyOpsToDoc(
      a.doc,
      { ops: [{ op: "move", refs: ["crate"], by: [10, 0] }] },
      ada,
      ENGINE,
    );
    const rb = applyOpsToDoc(
      b.doc,
      { ops: [{ op: "add", entity: { id: "flag", type: "marker", at: [50, 50] } }] },
      bob,
      ENGINE,
    );
    expect(ra.ok && rb.ok).toBe(true);
    await Promise.all([pushed(a.provider), pushed(b.provider)]);
    await until(() => text(a.doc) === text(b.doc), "the clients to converge");

    await until(async () => (await disk()) === text(a.doc), "the store");
    expect(text(serverDoc())).toBe(text(a.doc));
    const onDisk = parseSceneOrThrow(await disk(), ENGINE);
    expect(formatScene(onDisk).text).toBe(await disk());
    expect(onDisk.entities!.map((e) => e.id)).toContain("flag");
    expect(onDisk.entities!.find((e) => e.id === "crate")!.shape).toEqual([
      "circle",
      1210,
      940,
      20,
    ]);
  });

  it("doesn't echo its own writes back as disk transactions", async () => {
    const a = await connect();
    const b = await connect();
    const seen = record(b.doc);
    const before = await disk();
    applyOpsToDoc(
      a.doc,
      { ops: [{ op: "setScene", set: { name: "renamed" } }] },
      { kind: "user", userId: "ada" },
      ENGINE,
    );
    await pushed(a.provider);
    await until(async () => (await disk()) !== before, "the store");
    await new Promise((r) => setTimeout(r, 200));
    await server.idle();

    expect(seen).toHaveLength(1);
    expect(seen[0]!.entries.map((e) => e.actor.kind)).toEqual(["user"]);
    expect(readLog(serverDoc()).some((e) => e.actor.kind === "disk")).toBe(false);
    expect(JSON.parse(await disk()).name).toBe("renamed");
  });
});
