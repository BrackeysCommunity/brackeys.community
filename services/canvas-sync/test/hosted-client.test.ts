import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCli } from "../../../scripts/scene/commands.ts";
import type { ToolContext } from "../../../scripts/scene/context.ts";
import {
  AGENT_SITE_ENV,
  AGENT_TOKEN_ENV,
  SYNC_TOKEN_REFRESH_MARGIN_MS,
} from "../../../scripts/scene/hosted.ts";
import { MCP_TOOLS, runMcpTool } from "../../../scripts/scene/mcp-tools.ts";
import { openLiveProject } from "../../../scripts/scene/project-client.ts";
import { openProject } from "../../../scripts/scene/projects.ts";
import { loadCompatRapier } from "../../../scripts/scene/rapier-compat.ts";
import { docNameOf, memoryContentStore } from "../../../src/engine/project/index.ts";
import { emptyProjectState } from "../../../src/lib/scene/project-bytes.ts";
import { startServer, type SyncServer } from "../src/index.ts";
import {
  agentSyncToken,
  connectDoc,
  createMemoryProject,
  type EngineClient,
  memoryEngineStores,
  projectLogOf,
  projectStateOf,
  projectToken,
  sceneOf,
  sceneSynced,
  SECRET,
  until,
} from "./harness.ts";

setDefaultTimeout(60_000);

const quiet = { captureException() {}, capture() {}, async shutdown() {} };
const SITE = "https://staging.example.test";
const SECRET_AGENT = "jat_hostedClientTestSecret";
const READ_AGENT = "jat_hostedClientReadOnly";
const PROJECT = "hosted-demo";
const AGENT = "agent-1";
const OWNER = "ada";
const ENGINE_YARD = new URL("../../../src/engine/scenes/engine-yard.json", import.meta.url);

/** A 1×1 PNG. */
const DOT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const stores = memoryEngineStores();
const blobs = memoryContentStore();
let server: SyncServer;
let root: string;
let ctx: ToolContext;
let human: EngineClient;
/** How long the next grants live by the site's clock; the CLI refreshes `SYNC_TOKEN_REFRESH_MARGIN_MS` before. */
let grantMs = 60_000;
const exchanges: { access: string }[] = [];
const uploads: { kind: string | null; type: string | null; expect: string | null }[] = [];

/**
 * The site's agent routes as `src/lib/engine/routes.ts` answers them, in
 * memory: the token exchange mints a real project sync token with `g` and
 * `o` for this service, and the blob routes keep bytes by hash and record
 * them for the project as `engine_blobs` does.
 */
const site = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
  const headers = new Headers(init?.headers);
  const bearer = headers.get("authorization")?.replace(/^Bearer /, "");
  const access = bearer === SECRET_AGENT ? "write" : bearer === READ_AGENT ? "read" : null;
  if (!access) return Response.json({ message: "That agent token isn't valid." }, { status: 401 });
  if (url.pathname === "/api/engine/agent-sync-token") {
    exchanges.push({ access });
    const now = Date.now();
    const second = Math.floor(now / 1000) * 1000;
    return Response.json(
      {
        token: await agentSyncToken(PROJECT, AGENT, OWNER, { access, name: "Claude" }),
        url: `ws://127.0.0.1:${server.port}`,
        access,
        projectId: PROJECT,
        agentId: AGENT,
        expiresAt: second + grantMs,
      },
      { headers: { date: new Date(second).toUTCString() } },
    );
  }
  const blob = /^\/api\/engine\/projects\/([^/]+)\/blobs(?:\/([0-9a-f]{64}))?$/.exec(url.pathname);
  if (blob?.[1] === PROJECT) {
    if (blob[2]) {
      const bytes = await blobs.get(blob[2]);
      if (!bytes) return Response.json({ message: "Not found." }, { status: 404 });
      return new Response(init?.method === "HEAD" ? null : new Uint8Array(bytes));
    }
    if (access !== "write")
      return Response.json({ message: "That agent token is read-only." }, { status: 403 });
    const bytes = new Uint8Array(await new Response(init?.body).arrayBuffer());
    uploads.push({
      kind: headers.get("x-asset-kind"),
      type: headers.get("content-type"),
      expect: headers.get("x-expect-sha256"),
    });
    const sha256 = await blobs.put(bytes, headers.get("x-expect-sha256") ?? undefined);
    stores.projects.addBlob(PROJECT, sha256);
    return Response.json({ sha256, bytes: bytes.byteLength }, { status: 201 });
  }
  return Response.json({ message: "Not found." }, { status: 404 });
}) as typeof fetch;

const sceneDoc = docNameOf({ kind: "scene", project: PROJECT, key: "engine-yard" });
const speedOf = (client: EngineClient) => {
  const scene = sceneOf(client.doc);
  const def = scene
    ? (JSON.parse(scene.text) as { entities: { id: string; path?: { speed: number } }[] })
    : null;
  return def?.entities.find((e) => e.id === "lift")?.path?.speed;
};
const logOf = (client: EngineClient) =>
  client.doc.getArray<{ actor: unknown; label: string }>("log").toArray();

async function cli(argv: string[], env: Record<string, string> = {}) {
  const r = await runCli([...argv, "--json"], { ...ctx, env });
  return { exitCode: r.exitCode, data: JSON.parse(r.stdout) as Record<string, unknown> };
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "hosted-client-"));
  const dir = join(root, PROJECT);
  await mkdir(dir);
  await copyFile(ENGINE_YARD, join(dir, "engine-yard.json"));
  await writeFile(
    join(dir, "jams.project.json"),
    JSON.stringify({ kind: "project", v: 1, id: PROJECT, name: "Demo", game: null }),
  );
  await writeFile(join(root, "dot.png"), DOT);
  await writeFile(
    join(root, "slow-lift.json"),
    JSON.stringify({
      label: "Slow the lift",
      ops: [{ op: "update", ref: "lift", set: { "path.speed": 60 } }],
    }),
  );

  createMemoryProject(
    stores,
    {
      ...emptyProjectState(PROJECT, "Demo"),
      assets: {
        "engine-yard": {
          key: "engine-yard",
          id: "engine-yard",
          kind: "scene",
          path: "engine-yard.json",
          created: { at: 0, by: "disk" },
        },
      },
    },
    { "engine-yard": await Bun.file(ENGINE_YARD).text() },
  );
  server = await startServer({
    port: 0,
    secret: SECRET,
    ...stores.options,
    instanceId: "hosted-client",
    telemetry: quiet,
    debounceMs: 50,
    maxDebounceMs: 200,
  });
  ctx = {
    projects: [await openProject(dir, { cacheDir: join(root, "cache") })],
    loadRapier: loadCompatRapier,
    fetch: site,
  };
  human = connectDoc(server.port, sceneDoc, () => projectToken(PROJECT, "bob", { scoped: true }));
  expect(await sceneSynced(human)).toBe(true);
});

afterAll(async () => {
  human?.destroy();
  await server?.stop();
  await rm(root, { recursive: true, force: true });
});

describe("the CLI on a hosted project", () => {
  it("applies a live batch as the agent token's actor, which the scene's log records", async () => {
    const r = await cli([
      "apply",
      "engine-yard",
      "--live",
      "--url",
      SITE,
      "--token",
      SECRET_AGENT,
      "--ops",
      join(root, "slow-lift.json"),
      "--agent",
      "ignored",
    ]);
    expect(r.exitCode, JSON.stringify(r.data)).toBe(0);
    expect(r.data).toMatchObject({
      written: true,
      live: true,
      url: SITE,
      project: PROJECT,
      actor: { kind: "agent", agentId: AGENT, onBehalfOf: OWNER },
    });
    expect(await until(() => speedOf(human) === 60)).toBe(true);
    expect(logOf(human).at(-1)).toMatchObject({
      label: "Slow the lift",
      actor: { kind: "agent", agentId: AGENT, onBehalfOf: OWNER },
    });
    expect(JSON.stringify(r.data)).not.toContain(SECRET_AGENT);
  });

  it(`reads the token from ${AGENT_TOKEN_ENV} when --token is left out`, async () => {
    const listed = await cli(["assets", "list", "--live", "--url", SITE], {
      [AGENT_TOKEN_ENV]: SECRET_AGENT,
    });
    expect(listed.exitCode).toBe(0);
    expect(listed.data).toMatchObject({
      live: true,
      assets: [{ project: PROJECT, id: "engine-yard", kind: "scene" }],
    });
    const none = await cli(["assets", "list", "--live", "--url", SITE]);
    expect(none.exitCode).toBe(2);
    expect(String(none.data.error)).toContain(AGENT_TOKEN_ENV);
  });

  it("imports a binary through the site's blob route, then logs the registry change as the agent", async () => {
    const r = await cli([
      "assets",
      "import",
      join(root, "dot.png"),
      "--path",
      "art/",
      "--live",
      "--url",
      SITE,
      "--token",
      SECRET_AGENT,
    ]);
    expect(r.exitCode, JSON.stringify(r.data)).toBe(0);
    expect(uploads).toEqual([{ kind: "texture", type: "image/png", expect: expect.any(String) }]);
    const registry = connectDoc(server.port, `project:${PROJECT}`, () =>
      projectToken(PROJECT, "bob", { scoped: true }),
    );
    try {
      expect(await sceneSynced(registry)).toBe(true);
      const entry = Object.values(projectStateOf(registry.doc).assets).find((e) => e.id === "dot");
      expect(entry).toMatchObject({
        kind: "texture",
        path: "art/dot.png",
        sha256: uploads[0]!.expect,
      });
      expect(registry.doc.getArray<{ actor: unknown }>("log").toArray().at(-1)?.actor).toEqual({
        kind: "agent",
        agentId: AGENT,
        onBehalfOf: OWNER,
      });
    } finally {
      registry.destroy();
    }
  });

  it("runs every other --live writer as the agent, which the logs record", async () => {
    const registry = connectDoc(server.port, `project:${PROJECT}`, () =>
      projectToken(PROJECT, "bob", { scoped: true }),
    );
    const agent = { kind: "agent", agentId: AGENT, onBehalfOf: OWNER };
    const live = ["--live", "--url", SITE, "--token", SECRET_AGENT];
    const entry = (id: string) =>
      Object.values(projectStateOf(registry.doc).assets).find((e) => e.id === id);
    const editScene = join(root, "edit-scene.json");
    await writeFile(
      editScene,
      JSON.stringify({
        v: 1,
        ops: [
          {
            op: "editScene",
            id: "engine-yard",
            ops: [{ op: "update", ref: "lift", set: { "path.speed": 75 } }],
          },
        ],
      }),
    );
    const cases: { argv: string[]; landed: () => boolean; inScene?: true }[] = [
      {
        argv: ["assets", "rename", "dot", "--name", "Dot"],
        landed: () => entry("dot")?.name === "Dot",
      },
      {
        argv: ["assets", "move", "dot", "--to", "textures/"],
        landed: () => entry("dot")?.path === "textures/dot.png",
      },
      {
        argv: ["assets", "set-import", "dot", "--set", "filter=nearest"],
        landed: () => entry("dot")?.import?.filter === "nearest",
      },
      {
        argv: ["assets", "change-id", "dot", "speck"],
        landed: () => entry("speck") !== undefined && entry("dot") === undefined,
      },
      {
        argv: ["assets", "delete", "speck"],
        landed: () => entry("speck")?.deleted !== undefined,
      },
      {
        argv: ["assets", "restore", "speck"],
        landed: () => entry("speck") !== undefined && entry("speck")?.deleted === undefined,
      },
      {
        argv: ["assets", "apply", "--ops", editScene],
        landed: () => speedOf(human) === 75,
        inScene: true,
      },
    ];
    try {
      expect(await sceneSynced(registry)).toBe(true);
      const logged = projectLogOf(registry.doc).length;
      const dry = await cli(["assets", "rename", "dot", "--name", "Nope", ...live, "--dry-run"]);
      expect(dry.exitCode, JSON.stringify(dry.data)).toBe(0);
      expect(dry.data).toMatchObject({ written: false });
      expect(projectLogOf(registry.doc).length).toBe(logged);
      expect(entry("dot")?.name).toBeUndefined();
      for (const c of cases) {
        const what = c.argv.slice(0, 2).join(" ");
        const r = await cli([...c.argv, ...live]);
        expect(r.exitCode, `${what}: ${JSON.stringify(r.data)}`).toBe(0);
        expect(JSON.stringify(r.data), what).not.toContain(SECRET_AGENT);
        expect(await until(c.landed), what).toBe(true);
        const log = c.inScene ? logOf(human) : projectLogOf(registry.doc);
        expect(log.at(-1)?.actor, what).toEqual(agent);
      }
      expect(entry("speck")?.name).toBe("Dot");
    } finally {
      registry.destroy();
    }
  });

  it("reads the hosted project's tree and references with --live", async () => {
    const live = ["--live", "--url", SITE, "--token", SECRET_AGENT];
    const tree = await cli(["project", "tree", ...live]);
    expect(tree.exitCode, JSON.stringify(tree.data)).toBe(0);
    expect(tree.data).toMatchObject({ project: PROJECT, live: true, url: SITE });
    expect(JSON.stringify(tree.data.tree)).toContain(
      `"id":"speck","kind":"texture","path":"textures/dot.png"`,
    );
    const refs = await cli(["project", "refs", "engine-yard", ...live]);
    expect(refs.exitCode, JSON.stringify(refs.data)).toBe(0);
    expect(refs.data).toMatchObject({ project: PROJECT, live: true });
  });

  it("refuses a write with a read-only token, and lets it dry-run", async () => {
    const ops = join(root, "slow-lift.json");
    const base = ["apply", "engine-yard", "--live", "--url", SITE, "--ops", ops];
    const write = await cli([...base, "--token", READ_AGENT]);
    expect(write.exitCode).toBe(1);
    expect(String(write.data.error)).toMatch(/read-only/);
    const dry = await cli([...base, "--token", READ_AGENT, "--dry-run"]);
    expect(dry.exitCode, JSON.stringify(dry.data)).toBe(0);
    expect(dry.data).toMatchObject({ dryRun: true, written: false });
  });

  it("reports the site's refusal of an unknown token without echoing it", async () => {
    const r = await cli(["assets", "list", "--live", "--url", SITE, "--token", "jat_nope"]);
    expect(r.exitCode).toBe(1);
    expect(String(r.data.error)).toMatch(/doesn't know this agent token/);
    expect(JSON.stringify(r.data)).not.toContain("jat_nope");
  });

  it("refreshes the sync token before it expires as more docs open", async () => {
    grantMs = SYNC_TOKEN_REFRESH_MARGIN_MS + 300;
    const before = exchanges.length;
    const { client } = await openLiveProject({
      projects: ctx.projects,
      url: SITE,
      token: SECRET_AGENT,
      fetch: site,
    });
    try {
      expect(exchanges.length).toBe(before + 1);
      await Bun.sleep(400);
      const opened = await client.session.open(sceneDoc);
      expect(exchanges.length).toBe(before + 2);
      client.session.release(sceneDoc);
      expect(opened.doc).toBeDefined();
    } finally {
      await client.close();
      grantMs = 60_000;
    }
  });
});

describe("the MCP tools on a hosted project", () => {
  const call = async (
    name: string,
    input: Record<string, unknown>,
    env: Record<string, string>,
  ) => {
    const tool = MCP_TOOLS.find((t) => t.name === name)!;
    return runMcpTool(tool, input, { ...ctx, env });
  };

  it("takes a hosted URL only with the agent token and the site in the server's environment", async () => {
    const hosted = { scene: "engine-yard", live: true, url: SITE };
    const refused = await call("scene_show", hosted, {});
    expect(refused).toMatchObject({ isError: true, structuredContent: { exitCode: 2 } });
    expect(JSON.stringify(refused)).toContain(AGENT_TOKEN_ENV);

    const noSite = await call("scene_show", hosted, { [AGENT_TOKEN_ENV]: SECRET_AGENT });
    expect(noSite).toMatchObject({ isError: true, structuredContent: { exitCode: 2 } });
    expect(JSON.stringify(noSite)).toContain(AGENT_SITE_ENV);

    const elsewhere = await call(
      "scene_show",
      { ...hosted, url: "https://elsewhere.example.test" },
      { [AGENT_TOKEN_ENV]: SECRET_AGENT, [AGENT_SITE_ENV]: SITE },
    );
    expect(elsewhere).toMatchObject({ isError: true, structuredContent: { exitCode: 2 } });
    expect(JSON.stringify(elsewhere)).toContain(AGENT_SITE_ENV);
    expect(JSON.stringify(elsewhere)).not.toContain(SECRET_AGENT);

    const shown = await call(
      "scene_show",
      { ...hosted, ref: "lift" },
      { [AGENT_TOKEN_ENV]: SECRET_AGENT, [AGENT_SITE_ENV]: SITE },
    );
    expect(shown.structuredContent).toMatchObject({ exitCode: 0, live: true, url: SITE });
    expect(JSON.stringify(shown)).not.toContain(SECRET_AGENT);
  });
});
