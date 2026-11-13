// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInThisContext } from "node:vm";
import type { MessagePort } from "node:worker_threads";

import { finishExport, planContent, type BuiltCode, type ExportInput } from "@jams/engine/export";
import {
  checkSceneVersion,
  PROJECT_FILE,
  readSceneVersion,
  sha256,
  type ReleaseManifest,
} from "@jams/engine/project";
import { diffExpanded, expandScene, parseScene } from "@jams/engine/scene";
import { frameMessageSchema, hostMessageSchema, liveSnapshotSchema } from "@jams/engine/standalone";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { discoverProjects } from "../../scene/projects";
import { exportInputOf } from "../../scene/tools/game-build";
import { readVersionFiles } from "../../scene/tools/replay";
import {
  buildLiveFixture,
  fetchedVersion,
  judgeLive,
  judgeRun,
  LIVE_DIR,
  LIVE_RUN_TIMEOUT_MS,
  LIVE_TIMING,
  liveFiles,
  liveRuns,
  liveSnapshot,
  readRecording,
  readReplay,
  recordingDownload,
  RECORDING_REQUEST,
  RUN_TIMEOUT_MS,
  runTimeoutMs,
  SMOKE_BUILDS,
  type HostProbe,
  type LiveFixture,
  type LiveProbe,
  type LiveStateSeen,
  type RunObservation,
} from "../export";
import { REPO } from "../pack";

const ORIGIN = "http://127.0.0.1:41234";
const PLATFORMER = join(REPO, "src/games/platformer");
const VERSION = "a".repeat(64);
const RELEASE = "b".repeat(64);
const SCENE = "test-yard";

// ─── The fixture version ─────────────────────────────────

const WASM = "code/rapier_wasm2d_bg-abc123.wasm";
/** The platformer's code as the bundler would hash it: its entry and Rapier's wasm. */
const builtCode: BuiltCode = {
  files: [
    { path: "code/main-abc123.js", sha256: "d".repeat(64), bytes: 1000, role: "code" },
    { path: WASM, sha256: "e".repeat(64), bytes: 2000, role: "wasm" },
  ],
  entry: "code/main-abc123.js",
  rapier: { package: "@dimforge/rapier2d", version: "0.19.3", file: WASM, bytes: 2000 },
  thirdParty: [],
};

describe("the fixture version", () => {
  let tmp: string;
  let input: ExportInput;
  let manifest: ReleaseManifest;
  let fixture: LiveFixture;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), "export-live-"));
    const projects = await discoverProjects(PLATFORMER, [PROJECT_FILE], {
      cacheDirOf: (id) => join(tmp, "cache-test", id),
    });
    const got = await exportInputOf(projects[0]!, "web");
    if ("exitCode" in got) throw new Error(got.text);
    input = got;
    // The release as `game build` writes its manifest; the code files don't reach the version.
    ({ manifest } = await finishExport(await planContent(input), builtCode, input));
    fixture = await buildLiveFixture(manifest, {
      projectDir: PLATFORMER,
      cacheDir: join(tmp, "cache"),
    });
  }, 120_000);

  afterAll(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("is a version of the release's start scene, named by its file's hash", async () => {
    expect(fixture.scene).toBe(manifest.flow.start);
    expect(fixture.version.scene).toBe(fixture.scene);
    expect(await sha256(fixture.versionText)).toBe(fixture.id);
    expect(fixture.sceneFile).toBe(join(PLATFORMER, "scenes", `${fixture.scene}.json`));
  });

  it("goes live on the release: no compatibility error with its texts", () => {
    const issues = checkSceneVersion(manifest, fixture.version, fixture.texts);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("moves the cheese and nothing else, so the swap is a reconcile", () => {
    const read = readSceneVersion(fixture.version, fixture.texts, input.registry, input.game, {
      engine: input.engine,
    });
    if (!read.ok) throw new Error(JSON.stringify(read.issues));
    const own = parseScene(input.texts.get(fixture.scene)!, input.registry);
    if (!own.ok) throw new Error(JSON.stringify(own.issues));
    const before = expandScene(own.def, input.registry, { engine: input.engine });
    expect(diffExpanded(before, read.scene)).toEqual({
      added: [],
      removed: [],
      changed: ["cheese"],
      header: false,
    });
  });

  it("carries the edited scene's text, served from live/ since the release doesn't ship it", () => {
    const shipped = new Set(Object.values(manifest.assets).map((a) => a.sha256));
    const scene = fixture.version.assets[fixture.scene]!;
    expect(scene.storage).toBe("doc");
    expect(scene.file).toBe(`${LIVE_DIR}/${scene.sha256}.json`);
    expect(shipped.has(scene.sha256)).toBe(false);
    expect(fixture.texts.has(scene.sha256)).toBe(true);
  });

  it("writes the overlay's files under live/ and the replay's versions directory", async () => {
    const files = liveFiles(fixture);
    expect([...files.build.keys()].sort()).toEqual(
      [fixture.id, ...fixture.texts.keys()].map((h) => `${LIVE_DIR}/${h}.json`).sort(),
    );
    expect(files.build.get(`${LIVE_DIR}/${fixture.id}.json`)).toBe(fixture.versionText);
    for (const [path, text] of files.build) {
      const named = /^live\/([0-9a-f]{64})\.json$/.exec(path)?.[1];
      expect(await sha256(text)).toBe(named);
    }
    expect(files.versions.get("scene-version.json")).toBe(fixture.versionText);

    const dir = join(tmp, "versions");
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(dir, { recursive: true });
    for (const [path, text] of files.versions) await writeFile(join(dir, path), text);
    const held = await readVersionFiles(dir, { recursive: true });
    expect(held.problems).toEqual([]);
    expect(held.versions.map((v) => v.id)).toEqual([fixture.id]);
    expect([...held.versions[0]!.texts.keys()].sort()).toEqual([...fixture.texts.keys()].sort());
  });

  it("refuses an edit that doesn't apply", async () => {
    const bad = join(tmp, "bad-edit.json");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(bad, JSON.stringify({ ops: [{ op: "update", ref: "no-such", set: {} }] }));
    await expect(
      buildLiveFixture(manifest, { projectDir: PLATFORMER, cacheDir: join(tmp, "c2"), edit: bad }),
    ).rejects.toThrow(/op 0 failed/);
  });
});

// ─── The stub's messages ─────────────────────────────────

type StubRecord = HostProbe & {
  downloads: (HostProbe["downloads"][number] & { text: string | null })[];
  send(m: unknown): boolean;
};

/** Runs the stub page's script against a fake window and frame; returns what it recorded and the frame's port. */
async function runStub(): Promise<{
  record: StubRecord;
  frame: { src: string };
  port: MessagePort;
  heard: unknown[];
  close(): void;
}> {
  const html = await readFile(join(REPO, "scripts/engine-smoke/host-stub.html"), "utf8");
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!script) throw new Error("host-stub.html has no script");
  const listeners: ((e: { source: unknown; data: unknown }) => void)[] = [];
  const contentWindow = { postMessage: vi.fn() };
  const frame = { src: "", contentWindow };
  const win: Record<string, unknown> = {
    addEventListener: (type: string, fn: (e: { source: unknown; data: unknown }) => void) => {
      if (type === "message") listeners.push(fn);
    },
  };
  const doc = { getElementById: () => frame, body: { textContent: "" } };
  const location = { search: `?frame=${encodeURIComponent(`${ORIGIN}/`)}` };
  const run = runInThisContext(`(function (window, document, location) {${script}\n})`) as (
    w: unknown,
    d: unknown,
    l: unknown,
  ) => void;
  run(win, doc, location);
  for (const fn of listeners)
    fn({ source: contentWindow, data: { type: "jams:frame-ready", protocol: 1 } });
  const [hostMessage, origin, transfer] = contentWindow.postMessage.mock.calls[0] as [
    unknown,
    string,
    MessagePort[],
  ];
  expect(hostMessage).toEqual({ type: "jams:host", protocol: 1 });
  expect(origin).toBe("*");
  const port = transfer[0]!;
  const heard: unknown[] = [];
  port.on("message", (m: unknown) => heard.push(m));
  const record = win.__hostStub as StubRecord;
  return {
    record,
    frame,
    port,
    heard,
    close: () => port.close(),
  };
}

const tick = () => new Promise((r) => setTimeout(r, 20));

describe("the stub host's messages", () => {
  it("frames the build with ?host=jams and hands it a port", async () => {
    const stub = await runStub();
    try {
      expect(stub.frame.src).toBe(`${ORIGIN}/?host=jams`);
      expect(stub.record.handshakes).toBe(1);
    } finally {
      stub.close();
    }
  });

  it("answers hello and keeps the frame's features", async () => {
    const stub = await runStub();
    try {
      const hello = {
        type: "hello",
        id: 1,
        params: { engine: "0.14.4", release: RELEASE, game: "platformer", features: ["live"] },
      };
      expect(frameMessageSchema.safeParse(hello).success).toBe(true);
      stub.port.postMessage(hello);
      await tick();
      expect(stub.record.hello?.features).toEqual(["live"]);
      const reply = stub.heard[0] as { type: string; id: number; ok: boolean };
      expect(reply).toMatchObject({ type: "reply", id: 1, ok: true });
      expect(hostMessageSchema.safeParse(reply).success).toBe(true);
    } finally {
      stub.close();
    }
  });

  it("records each live.state report without its type, and each download with its text", async () => {
    const stub = await runStub();
    try {
      const state = {
        type: "live.state",
        scene: SCENE,
        version: VERSION,
        status: "applied",
        timing: "now",
        strategy: "reconcile",
        tick: 42,
      };
      expect(frameMessageSchema.safeParse(state).success).toBe(true);
      stub.port.postMessage(state);
      const text = JSON.stringify({ scene: SCENE, ticks: 90, end: "e".repeat(64) });
      const bytes = new TextEncoder().encode(text).buffer as ArrayBuffer;
      const download = {
        type: "download",
        name: `${SCENE}.recording.json`,
        contentType: "application/json",
        bytes,
      };
      expect(frameMessageSchema.safeParse(download).success).toBe(true);
      stub.port.postMessage(download);
      await tick();
      const { type: _type, ...report } = state;
      expect(stub.record.live).toEqual([report]);
      expect(stub.record.downloads).toEqual([
        {
          name: `${SCENE}.recording.json`,
          contentType: "application/json",
          bytes: bytes.byteLength,
          text,
        },
      ]);
      expect(stub.record.invalid).toBe(0);
    } finally {
      stub.close();
    }
  });

  it("sends the smoke's live.update and recording request over the port", async () => {
    const stub = await runStub();
    try {
      const update = {
        type: "live.update",
        live: liveSnapshot(RELEASE, SCENE, VERSION, "2026-11-13T00:00:00.000Z"),
      };
      expect(hostMessageSchema.safeParse(update).success).toBe(true);
      expect(stub.record.send(update)).toBe(true);
      expect(stub.record.send(RECORDING_REQUEST)).toBe(true);
      await tick();
      expect(stub.heard).toEqual([update, RECORDING_REQUEST]);
    } finally {
      stub.close();
    }
  });
});

// ─── The snapshot and the run ────────────────────────────

describe("the live run", () => {
  it("frames the platformer's web build once in every browser, with its own time limit", () => {
    const browsers = ["chromium", "firefox", "webkit"] as const;
    expect(liveRuns(SMOKE_BUILDS, browsers)).toEqual(
      browsers.map((browser) => ({ build: "platformer-web", mount: "/", browser, kind: "live" })),
    );
    expect(liveRuns([], browsers)).toEqual([]);
    expect(runTimeoutMs("live")).toBe(LIVE_RUN_TIMEOUT_MS);
    expect(LIVE_RUN_TIMEOUT_MS).toBeGreaterThan(RUN_TIMEOUT_MS);
    expect(runTimeoutMs("host")).toBe(RUN_TIMEOUT_MS);
  });

  it("points one scene at the version with timing now, as the page's schema reads it", () => {
    const snap = liveSnapshot(RELEASE, SCENE, VERSION, "2026-11-13T00:00:00.000Z");
    expect(liveSnapshotSchema.parse(snap)).toEqual(snap);
    expect(snap.scenes).toEqual([
      { scene: SCENE, version: VERSION, number: 1, timing: "now", since: snap.scenes[0]!.since },
    ]);
    expect(LIVE_TIMING).toBe("now");
  });
});

// ─── The request log ─────────────────────────────────────

describe("the request-log rule", () => {
  it("finds the version's file only under the frame's own mount and origin", () => {
    const url = (path: string, origin = ORIGIN) => `${origin}${path}`;
    expect(fetchedVersion([url(`/live/${VERSION}.json`)], ORIGIN, "/", VERSION)).toBe(true);
    expect(fetchedVersion([url(`/live/${VERSION}.json`)], ORIGIN, "/games/t/", VERSION)).toBe(
      false,
    );
    expect(
      fetchedVersion([url(`/live/${VERSION}.json`, "http://127.0.0.1:1")], ORIGIN, "/", VERSION),
    ).toBe(false);
    expect(fetchedVersion([url(`/data/${VERSION}.json`)], ORIGIN, "/", VERSION)).toBe(false);
    expect(fetchedVersion(["not a url"], ORIGIN, "/", VERSION)).toBe(false);
  });

  it("fails a live run whose frame reached outside its directory", () => {
    const reasons = judgeRun(
      "live",
      liveObserved({
        mount: "/games/t/",
        requests: [`${ORIGIN}/games/t/live/${VERSION}.json`, `${ORIGIN}/live/${VERSION}.json`],
      }),
    );
    expect(reasons).toEqual([`requests outside /games/t/: ${ORIGIN}/live/${VERSION}.json`]);
  });
});

// ─── Judging ─────────────────────────────────────────────

const states = (...list: Partial<LiveStateSeen>[]): LiveStateSeen[] =>
  list.map((s) => ({ scene: SCENE, version: VERSION, status: "ready", ...s }));

const goodStates = states(
  { status: "staging" },
  { status: "ready", timing: "now" },
  { status: "applied", timing: "now", strategy: "reconcile", tick: 120 },
);

const goodHost: HostProbe = {
  handshakes: 1,
  hello: { engine: "0.14.4", release: RELEASE, game: "platformer", features: ["live"] },
  states: ["loading", "ready"],
  requests: ["hello"],
  live: goodStates,
  downloads: [{ name: `${SCENE}.recording.json`, contentType: "application/json", bytes: 900 }],
  invalid: 0,
};

const goodProbe: LiveProbe = {
  scene: SCENE,
  version: VERSION,
  recording: {
    name: `${SCENE}.recording.json`,
    scene: SCENE,
    ticks: 300,
    end: "e".repeat(64),
    sceneVersion: null,
    swaps: [{ tick: 120, version: VERSION, timing: "now", strategy: "reconcile" }],
  },
  replay: { matches: true, stale: false, divergence: null, end: "e".repeat(64) },
};

const requested = { urls: [`${ORIGIN}/live/${VERSION}.json`], origin: ORIGIN, mount: "/" };

function liveObserved(over: Partial<RunObservation> = {}): RunObservation {
  return {
    requests: [`${ORIGIN}/`, `${ORIGIN}/release.json`, `${ORIGIN}/live/${VERSION}.json`],
    failed: [],
    origin: ORIGIN,
    mount: "/",
    pwa: true,
    serviceWorkers: 0,
    play: { game: "platformer", before: "a", after: "b", colours: 12 },
    playReason: null,
    host: goodHost,
    release: RELEASE,
    live: goodProbe,
    ...over,
  };
}

describe("judgeLive", () => {
  it("passes a swap applied now whose recording replays to the same end", () => {
    expect(judgeLive(goodProbe, goodHost, requested)).toEqual([]);
    expect(judgeRun("live", liveObserved())).toEqual([]);
  });

  it("fails a run whose probe never ran", () => {
    expect(judgeLive(undefined, goodHost, requested)).toEqual(["the live probe didn't run"]);
    expect(judgeRun("live", liveObserved({ live: undefined }))).toEqual([
      "the live probe didn't run",
    ]);
  });

  it("judges the host side too: a worker in the frame, a bad handshake", () => {
    expect(judgeRun("live", liveObserved({ serviceWorkers: 1 }))).toEqual([
      "1 service worker(s) registered in a frame with a host",
    ]);
    expect(judgeRun("live", liveObserved({ host: { ...goodHost, handshakes: 2 } }))).toEqual([
      "the frame posted jams:frame-ready 2 times, not once",
    ]);
  });

  it("fails a frame that doesn't announce live or never fetched the version", () => {
    const noFeature = { ...goodHost, hello: { ...goodHost.hello!, features: [] } };
    expect(judgeLive(goodProbe, noFeature, requested)).toEqual([
      `the frame's hello doesn't list the "live" feature`,
    ]);
    expect(judgeLive(goodProbe, goodHost, { ...requested, urls: [] })).toEqual([
      `the frame never fetched /live/${VERSION}.json from its own directory`,
    ]);
  });

  it("names the issue of a refused or failed version, and stops there", () => {
    const refused = {
      ...goodHost,
      live: states(
        { status: "staging" },
        { status: "refused", issue: { code: "hash-mismatch", message: "stale cache" } },
      ),
    };
    expect(judgeLive({ ...goodProbe, recording: null }, refused, requested)).toEqual([
      `the frame reported ${SCENE}@${VERSION.slice(0, 12)} refused (hash-mismatch: stale cache)`,
    ]);
  });

  it("says where a version that never applied stopped", () => {
    const clamped = {
      ...goodHost,
      live: states(
        { status: "staging" },
        {
          status: "ready",
          timing: "next-load",
          issue: { code: "live-timing-unsupported", message: "next load only" },
        },
      ),
    };
    expect(judgeLive({ ...goodProbe, recording: null }, clamped, requested)).toEqual([
      `the frame never reported ${SCENE}@${VERSION.slice(0, 12)} applied; its last report was ready at next-load (live-timing-unsupported: next load only)`,
    ]);
    expect(judgeLive(goodProbe, { ...goodHost, live: [] }, requested)).toEqual([
      `the frame never reported ${SCENE}@${VERSION.slice(0, 12)} applied; its last report was none`,
    ]);
  });

  it("fails a swap applied at another timing, or reported out of order", () => {
    const boundary = {
      ...goodHost,
      live: states(
        { status: "staging" },
        { status: "ready" },
        { status: "applied", timing: "boundary", tick: 120, strategy: "reconcile" },
      ),
    };
    const swapAtBoundary = {
      ...goodProbe.recording!,
      swaps: [{ ...goodProbe.recording!.swaps[0]!, timing: "boundary" }],
    };
    expect(judgeLive({ ...goodProbe, recording: swapAtBoundary }, boundary, requested)).toEqual([
      `the frame applied ${SCENE}@${VERSION.slice(0, 12)} at boundary, not now`,
      `${SCENE}.recording.json records the swap at boundary, not now`,
    ]);
    const unordered = { ...goodHost, live: [goodStates[2]!, goodStates[0]!, goodStates[1]!] };
    expect(judgeLive(goodProbe, unordered, requested)).toEqual([
      `the frame reported ${SCENE}@${VERSION.slice(0, 12)} applied, staging, ready, not staging, ready, then applied`,
    ]);
  });

  it("fails when the frame offers no recording, or one that isn't", () => {
    expect(judgeLive({ ...goodProbe, recording: null }, goodHost, requested)).toEqual([
      "the frame offered no recording through download within 10000 ms of recording.request",
    ]);
    expect(
      judgeLive(
        { ...goodProbe, recording: null, recordingProblem: "x.recording.json isn't JSON" },
        goodHost,
        requested,
      ),
    ).toEqual(["x.recording.json isn't JSON"]);
  });

  it("fails a recording of another scene, without the swap, or with another tick or strategy", () => {
    const rec = goodProbe.recording!;
    const name = rec.name;
    expect(
      judgeLive({ ...goodProbe, recording: { ...rec, scene: "x" } }, goodHost, requested),
    ).toEqual([`${name} records the scene x, not ${SCENE}`]);
    expect(
      judgeLive({ ...goodProbe, recording: { ...rec, swaps: [] } }, goodHost, requested),
    ).toEqual([`${name} holds no swap to ${SCENE}@${VERSION.slice(0, 12)}`]);
    const moved = { ...rec, swaps: [{ ...rec.swaps[0]!, tick: 121, strategy: "reload" }] };
    expect(judgeLive({ ...goodProbe, recording: moved }, goodHost, requested)).toEqual([
      `${name} records the swap before tick 121, the frame reported tick 120`,
      `${name} records the swap as reload, the frame reported reconcile`,
    ]);
  });

  it("fails a recording that wasn't replayed, didn't replay, or replays elsewhere or stale", () => {
    const name = goodProbe.recording!.name;
    expect(judgeLive({ ...goodProbe, replay: null }, goodHost, requested)).toEqual([
      `${name} wasn't replayed`,
    ]);
    expect(judgeLive({ ...goodProbe, replay: { error: "boom" } }, goodHost, requested)).toEqual([
      "boom",
    ]);
    const other = { matches: false, stale: true, divergence: "end differs", end: "f".repeat(64) };
    expect(judgeLive({ ...goodProbe, replay: other }, goodHost, requested)).toEqual([
      `${name} replays headless to another end: end differs (recorded eeeeeeeeeeee…, replayed ffffffffffff…)`,
      `${name} replays stale: the replayed run isn't the one recorded`,
    ]);
  });
});

describe("reading the recording and its replay", () => {
  it("takes the first download named as a recording", () => {
    const d = (name: string) => ({ name, contentType: "application/json", bytes: 1 });
    expect(
      recordingDownload([d("credits.txt"), d("a.recording.json"), d("b.recording.json")]),
    ).toBe(1);
    expect(recordingDownload([d("credits.txt")])).toBeNull();
  });

  it("reads a recording's scene, ticks, end and swaps", () => {
    const text = JSON.stringify({
      scene: SCENE,
      ticks: 300,
      end: "e".repeat(64),
      swaps: [{ tick: 120, version: VERSION, timing: "now", strategy: "reconcile", runHash: "h" }],
    });
    expect(readRecording("r.recording.json", text)).toEqual({
      ok: true,
      recording: { ...goodProbe.recording!, name: "r.recording.json" },
    });
    expect(readRecording("r", "{")).toMatchObject({ ok: false, problem: /^r isn't JSON/ });
    expect(readRecording("r", "{}")).toEqual({
      ok: false,
      problem: "r isn't a run recording (no scene, ticks or end)",
    });
  });

  it("reads replay --json: the verdict and the replay's end, or why it was blocked", () => {
    const run = {
      game: "platformer",
      blocked: false,
      matches: true,
      stale: false,
      divergence: null,
      recording: { end: "e".repeat(64) },
    };
    expect(readReplay(`${JSON.stringify(run)}\n`)).toEqual(goodProbe.replay);
    expect(
      readReplay(
        JSON.stringify({
          ok: false,
          blocked: true,
          issues: [{ code: "scene-version-removed", message: "gone" }],
        }),
      ),
    ).toEqual({ error: "the replay didn't run: scene-version-removed: gone" });
    expect(readReplay("oops")).toEqual({ error: "replay --json printed no JSON: oops" });
  });
});
