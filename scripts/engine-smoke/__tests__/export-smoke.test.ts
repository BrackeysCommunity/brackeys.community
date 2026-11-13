// @vitest-environment node
import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vite-plus/test";

import {
  allRuns,
  buildName,
  checkRequests,
  CONTEXT_LOSS_BUILD,
  decodePng,
  distinctColours,
  exportSmokeOk,
  exportSmokeReport,
  hostRuns,
  judgeCanvasChange,
  judgeControlHit,
  judgeDrawn,
  judgeHost,
  judgeRun,
  launchFailures,
  liveRuns,
  pickReachCell,
  pixelHash,
  plannedRuns,
  renderRestore,
  requestScope,
  RESTORE_AFTER_MS,
  runOutcome,
  SMOKE_BUILDS,
  type BuildOutcome,
  type ContextLossProbe,
  type ExportSmokeReport,
  type HostProbe,
  type Image,
  type PlannedRun,
  type RunObservation,
  type RunOutcome,
} from "../export";

const ORIGIN = "http://127.0.0.1:41234";

// ─── A PNG encoder for the decoder's fixtures ───────────

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** `pixels` (row-major, `channels` per pixel) as a PNG whose rows use `filters` in turn. */
function encodePng(
  width: number,
  height: number,
  colourType: 0 | 2 | 4 | 6,
  pixels: number[],
  filters: number[] = [0],
): Buffer {
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colourType];
  const stride = width * channels;
  const out: number[] = [];
  for (let y = 0; y < height; y++) {
    const filter = filters[y % filters.length]!;
    out.push(filter);
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x;
      const left = x >= channels ? pixels[at - channels]! : 0;
      const up = y > 0 ? pixels[at - stride]! : 0;
      const upLeft = y > 0 && x >= channels ? pixels[at - stride - channels]! : 0;
      const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter]!;
      out.push((pixels[at]! - predicted) & 0xff);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colourType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from(out))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A 3×3 RGBA image whose every channel differs, so a wrong unfilter shows. */
const RGBA_3x3 = Array.from({ length: 36 }, (_, i) => (i * 37 + 11) % 256);

const image = (rgba: number[], width = 1, height = rgba.length / 4 / width): Image => ({
  width,
  height,
  rgba: Uint8Array.from(rgba),
});

// ─── Requests ────────────────────────────────────────────

describe("the origin filter", () => {
  it("passes the page's own requests and local URLs", () => {
    expect(requestScope(`${ORIGIN}/`, ORIGIN, "/")).toBe("page");
    expect(requestScope(`${ORIGIN}/assets/a.js?x=1`, ORIGIN, "/")).toBe("page");
    expect(requestScope(`${ORIGIN}/games/t/release.json`, ORIGIN, "/games/t/")).toBe("page");
    expect(requestScope("data:image/png;base64,AAAA", ORIGIN, "/")).toBe("local");
    expect(requestScope("about:blank", ORIGIN, "/")).toBe("local");
    expect(requestScope(`blob:${ORIGIN}/0b6c-uuid`, ORIGIN, "/")).toBe("local");
    expect(requestScope(`${ORIGIN}/favicon.ico`, ORIGIN, "/games/t/")).toBe("local");
  });

  it("catches another origin, another port, another scheme and a foreign blob", () => {
    expect(requestScope("https://jams.example/api/x", ORIGIN, "/")).toBe("off-origin");
    expect(requestScope("http://127.0.0.1:3000/", ORIGIN, "/")).toBe("off-origin");
    expect(requestScope("http://localhost:41234/", ORIGIN, "/")).toBe("off-origin");
    expect(requestScope("https://127.0.0.1:41234/", ORIGIN, "/")).toBe("off-origin");
    expect(requestScope("ws://127.0.0.1:41234/socket", ORIGIN, "/")).toBe("off-origin");
    expect(requestScope("blob:https://cdn.example/uuid", ORIGIN, "/")).toBe("off-origin");
    expect(requestScope("not a url", ORIGIN, "/")).toBe("off-origin");
  });

  it("catches requests on the server outside a nested mount", () => {
    expect(requestScope(`${ORIGIN}/release.json`, ORIGIN, "/games/t/")).toBe("outside-mount");
    expect(requestScope(`${ORIGIN}/games/sw.js`, ORIGIN, "/games/t/")).toBe("outside-mount");
    expect(requestScope(`${ORIGIN}/games/t`, ORIGIN, "/games/t/")).toBe("outside-mount");
  });

  it("lists each offending URL once, in the order first seen", () => {
    const urls = [
      `${ORIGIN}/games/t/`,
      "https://cdn.example/a.js",
      `${ORIGIN}/release.json`,
      "https://cdn.example/a.js",
      "https://fonts.example/f.woff2",
      `${ORIGIN}/release.json`,
    ];
    expect(checkRequests(urls, ORIGIN, "/games/t/")).toEqual({
      offOrigin: ["https://cdn.example/a.js", "https://fonts.example/f.woff2"],
      outsideMount: [`${ORIGIN}/release.json`],
    });
    expect(checkRequests([`${ORIGIN}/`, `${ORIGIN}/a.js`], ORIGIN, "/")).toEqual({
      offOrigin: [],
      outsideMount: [],
    });
  });
});

// ─── Pixels ──────────────────────────────────────────────

describe("decodePng", () => {
  it("reads RGBA through every row filter", () => {
    for (const filters of [[0], [1], [2], [3], [4], [0, 1, 2, 3, 4], [4, 3, 2]]) {
      const img = decodePng(encodePng(3, 3, 6, RGBA_3x3, filters));
      expect(img.width).toBe(3);
      expect(img.height).toBe(3);
      expect([...img.rgba], `filters ${filters.join(",")}`).toEqual(RGBA_3x3);
    }
  });

  it("widens RGB, grey and grey+alpha to RGBA", () => {
    expect([...decodePng(encodePng(2, 1, 2, [1, 2, 3, 4, 5, 6], [1])).rgba]).toEqual([
      1, 2, 3, 255, 4, 5, 6, 255,
    ]);
    expect([...decodePng(encodePng(2, 1, 0, [7, 9])).rgba]).toEqual([7, 7, 7, 255, 9, 9, 9, 255]);
    expect([...decodePng(encodePng(1, 1, 4, [7, 128])).rgba]).toEqual([7, 7, 7, 128]);
  });

  it("reads image data split over several IDAT chunks", () => {
    const png = encodePng(3, 3, 6, RGBA_3x3, [2]);
    const idatAt = png.indexOf("IDAT", 0, "latin1") - 4;
    const length = png.readUInt32BE(idatAt);
    const data = png.subarray(idatAt + 8, idatAt + 8 + length);
    const split = Buffer.concat([
      png.subarray(0, idatAt),
      chunk("IDAT", data.subarray(0, 5)),
      chunk("IDAT", data.subarray(5)),
      png.subarray(idatAt + 12 + length),
    ]);
    expect([...decodePng(split).rgba]).toEqual(RGBA_3x3);
  });

  it("refuses what it can't read", () => {
    expect(() => decodePng(Buffer.from("GIF89a"))).toThrow("not a PNG");
    const sixteen = encodePng(1, 1, 6, [1, 2, 3, 4]);
    sixteen[8 + 8 + 8] = 16;
    expect(() => decodePng(sixteen)).toThrow("unsupported PNG");
    const badFilter = encodePng(1, 1, 0, [1]);
    const at = badFilter.indexOf("IDAT", 0, "latin1") - 4;
    const body = deflateSync(Buffer.from([9, 1]));
    const broken = Buffer.concat([
      badFilter.subarray(0, at),
      chunk("IDAT", body),
      chunk("IEND", Buffer.alloc(0)),
    ]);
    expect(() => decodePng(broken)).toThrow("filter 9");
  });
});

describe("the pixel hash", () => {
  it("is equal for equal pixels, whatever the PNG's filters", () => {
    const a = decodePng(encodePng(3, 3, 6, RGBA_3x3, [0]));
    const b = decodePng(encodePng(3, 3, 6, RGBA_3x3, [4, 1]));
    expect(pixelHash(a)).toBe(pixelHash(b));
    expect(pixelHash(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes with one channel of one pixel, and with the size", () => {
    const base = image([10, 20, 30, 255, 40, 50, 60, 255]);
    const moved = image([10, 20, 31, 255, 40, 50, 60, 255]);
    expect(pixelHash(base)).not.toBe(pixelHash(moved));
    expect(pixelHash(image([1, 2, 3, 4, 5, 6, 7, 8], 2))).not.toBe(
      pixelHash(image([1, 2, 3, 4, 5, 6, 7, 8], 1)),
    );
  });

  it("judges a held key by whether the hash changed", () => {
    const h = pixelHash(image([1, 2, 3, 255]));
    expect(judgeCanvasChange(h, h)).toMatch(/stayed .*ArrowRight was held for 1000 ms/);
    expect(judgeCanvasChange(h, pixelHash(image([1, 2, 4, 255])))).toBeNull();
  });

  it("counts distinct colours up to the cap and judges a flat canvas undrawn", () => {
    expect(distinctColours(image([5, 5, 5, 255, 5, 5, 5, 0]))).toBe(1);
    expect(distinctColours(image([5, 5, 5, 255, 5, 5, 6, 255, 9, 9, 9, 255]))).toBe(3);
    const many = image(Array.from({ length: 400 }, (_, i) => (i % 4 === 3 ? 255 : i)));
    expect(distinctColours(many, 8)).toBe(8);
    expect(judgeDrawn(1)).toMatch(/one flat colour/);
    expect(judgeDrawn(0)).toMatch(/one flat colour/);
    expect(judgeDrawn(2)).toBeNull();
  });
});

// ─── Tactics ─────────────────────────────────────────────

describe("pickReachCell", () => {
  it("takes the farthest clear reachable cell, never the unit's own", () => {
    expect(
      pickReachCell("1,1", [
        { cell: "1,1", clear: true },
        { cell: "2,1", clear: true },
        { cell: "4,1", clear: true },
        { cell: "1,4", clear: false },
      ]),
    ).toBe("4,1");
  });

  it("breaks ties by row, then column", () => {
    expect(
      pickReachCell("2,2", [
        { cell: "3,3", clear: true },
        { cell: "1,1", clear: true },
        { cell: "3,1", clear: true },
      ]),
    ).toBe("1,1");
  });

  it("is null with no clear cell", () => {
    expect(pickReachCell("1,1", [])).toBeNull();
    expect(pickReachCell("1,1", [{ cell: "2,1", clear: false }])).toBeNull();
    expect(pickReachCell("1,1", [{ cell: "1,1", clear: true }])).toBeNull();
    expect(pickReachCell("1,1", [{ cell: "x", clear: true }])).toBeNull();
  });
});

describe("judgeControlHit", () => {
  it("passes a click that lands on the control or inside it", () => {
    expect(judgeControlHit("Start", { own: true })).toBeNull();
  });

  it("names what takes the click instead, so a covered control fails at once", () => {
    expect(judgeControlHit("Start", { own: false, hit: "canvas" })).toBe(
      "a click at Start's centre lands on the canvas, not Start: something over it takes the pointer, or Start passes pointer events through",
    );
    expect(judgeControlHit("Start", { own: false, hit: null })).toBe(
      "a click at Start's centre lands on nothing on the page",
    );
  });
});

// ─── Runs and the report ────────────────────────────────

describe("plannedRuns", () => {
  it("plays every build's mounts in every browser, and Chromium adds offline and context loss", () => {
    const runs = plannedRuns(SMOKE_BUILDS, ["chromium", "firefox", "webkit"]);
    const of = (browser: string) =>
      runs.filter((r) => r.browser === browser).map((r) => `${r.kind} ${r.build} ${r.mount}`);
    const plays = [
      "play platformer-web /",
      "play tactics-web /",
      "play tactics-itch /",
      "play tactics-itch /games/t/",
    ];
    expect(of("chromium")).toEqual([
      ...plays,
      "offline platformer-web /",
      "offline tactics-web /",
      "context-loss platformer-web /",
    ]);
    expect(of("firefox")).toEqual(plays);
    expect(of("webkit")).toEqual(plays);
  });

  it("builds the platformer for web and tactics for web and itch, itch with no PWA", () => {
    expect(SMOKE_BUILDS.map((b) => [buildName(b), b.pwa])).toEqual([
      ["platformer-web", true],
      ["tactics-web", true],
      ["tactics-itch", false],
    ]);
    expect(SMOKE_BUILDS.some((b) => buildName(b) === CONTEXT_LOSS_BUILD)).toBe(true);
    expect(RESTORE_AFTER_MS).toBeLessThan(3000);
  });
});

describe("hostRuns", () => {
  const browsers = ["chromium", "firefox", "webkit"] as const;

  it("frames tactics-web once in every browser", () => {
    expect(hostRuns(SMOKE_BUILDS, browsers)).toEqual(
      browsers.map((browser) => ({ build: "tactics-web", mount: "/", browser, kind: "host" })),
    );
  });

  it("puts each browser's host run after that browser's plays, and its live run last", () => {
    expect(allRuns(SMOKE_BUILDS, browsers)).toEqual(
      browsers.flatMap((b) => [
        ...plannedRuns(SMOKE_BUILDS, [b]),
        ...hostRuns(SMOKE_BUILDS, [b]),
        ...liveRuns(SMOKE_BUILDS, [b]),
      ]),
    );
    const firefox = allRuns(SMOKE_BUILDS, browsers).filter((r) => r.browser === "firefox");
    expect(firefox.slice(-2).map((r) => r.kind)).toEqual(["host", "live"]);
  });
});

const RELEASE = "r-1";
const goodHost: HostProbe = {
  handshakes: 1,
  hello: { engine: "0.14.1", release: RELEASE, game: "tactics" },
  states: ["loading", "ready"],
  requests: [],
  live: [],
  downloads: [],
  invalid: 0,
};

describe("judgeHost", () => {
  it("fails a run whose probe never ran", () => {
    expect(judgeHost(undefined, RELEASE)).toEqual(["the host probe didn't run"]);
  });

  it("passes one handshake, the build's hello and a ready state", () => {
    expect(judgeHost(goodHost, RELEASE)).toEqual([]);
  });

  it("gives one reason for each thing that went wrong", () => {
    const bad: Partial<HostProbe>[] = [
      { handshakes: 2 },
      { hello: null },
      { hello: { engine: "0.14.1", release: "r-2", game: "tactics" } },
      { states: ["loading", "error"] },
      { states: ["loading"] },
      { invalid: 1 },
    ];
    for (const over of bad) expect(judgeHost({ ...goodHost, ...over }, RELEASE)).toHaveLength(1);
  });
});

const platformerPlay = { game: "platformer", before: "a", after: "b", colours: 12 } as const;

const observed = (over: Partial<RunObservation> = {}): RunObservation => ({
  requests: [`${ORIGIN}/`, `${ORIGIN}/release.json`],
  failed: [],
  origin: ORIGIN,
  mount: "/",
  pwa: true,
  serviceWorkers: 1,
  play: platformerPlay,
  playReason: null,
  ...over,
});

const restoredLoss: ContextLossProbe = {
  extension: true,
  lost: true,
  restored: true,
  restoreMs: 40,
  rebuilt: false,
  colours: 9,
};

describe("judgeRun", () => {
  it("passes a clean run", () => {
    expect(judgeRun("play", observed())).toEqual([]);
    expect(judgeRun("offline", observed({ controlled: true }))).toEqual([]);
    expect(judgeRun("context-loss", observed({ contextLoss: restoredLoss }))).toEqual([]);
    expect(
      judgeRun("context-loss", observed({ contextLoss: { ...restoredLoss, rebuilt: true } })),
    ).toEqual([]);
  });

  it("fails on requests outside the origin or the mount", () => {
    const reasons = judgeRun(
      "play",
      observed({
        mount: "/games/t/",
        requests: [`${ORIGIN}/games/t/`, "https://jams.example/x", `${ORIGIN}/release.json`],
      }),
    );
    expect(reasons).toEqual([
      `requests outside ${ORIGIN}: https://jams.example/x`,
      `requests outside /games/t/: ${ORIGIN}/release.json`,
    ]);
  });

  it("fails a build without a PWA that registered a service worker, never one with", () => {
    expect(judgeRun("play", observed({ pwa: false, serviceWorkers: 1 }))).toEqual([
      "1 service worker(s) registered by a build without a PWA",
    ]);
    expect(judgeRun("play", observed({ pwa: false, serviceWorkers: 0 }))).toEqual([]);
  });

  it("fails offline when the service worker doesn't control the reload", () => {
    expect(judgeRun("offline", observed({ controlled: false }))).toEqual([
      "offline, the reloaded page isn't controlled by the build's service worker",
    ]);
    expect(judgeRun("offline", observed())).toHaveLength(1);
  });

  it("fails context loss on each missing step", () => {
    expect(judgeRun("context-loss", observed())).toEqual(["the context-loss probe didn't run"]);
    expect(
      judgeRun("context-loss", observed({ contextLoss: { ...restoredLoss, extension: false } })),
    ).toEqual(["WEBGL_lose_context isn't available on the canvas"]);
    const reasons = judgeRun(
      "context-loss",
      observed({
        contextLoss: { ...restoredLoss, lost: false, restored: false, colours: 1 },
      }),
    );
    expect(reasons).toHaveLength(3);
    expect(reasons[0]).toMatch(/render:lost/);
    expect(reasons[1]).toMatch(/render:restored/);
    expect(reasons[2]).toMatch(/after the restore, the canvas is one flat colour/);
  });

  it("reads a restore from data-jams-render: restored in place, rebuilt, or still lost", () => {
    expect(renderRestore("restored")).toEqual({ restored: true, rebuilt: false });
    expect(renderRestore("rebuilt")).toEqual({ restored: true, rebuilt: true });
    expect(renderRestore("lost")).toEqual({ restored: false, rebuilt: false });
    expect(renderRestore(undefined)).toEqual({ restored: false, rebuilt: false });
  });

  it("fails a host run whose frame registered a service worker", () => {
    expect(
      judgeRun("host", observed({ serviceWorkers: 1, host: goodHost, release: RELEASE })),
    ).toContain("1 service worker(s) registered in a frame with a host");
    expect(
      judgeRun("host", observed({ serviceWorkers: 0, host: goodHost, release: RELEASE })),
    ).toEqual([]);
  });

  it("carries the play check's own verdict last", () => {
    expect(
      judgeRun("play", observed({ requests: ["https://x.example/"], playReason: "didn't move" })),
    ).toEqual(["requests outside http://127.0.0.1:41234: https://x.example/", "didn't move"]);
  });
});

const planned = (over: Partial<PlannedRun> = {}): PlannedRun => ({
  build: "platformer-web",
  mount: "/",
  browser: "chromium",
  kind: "play",
  ...over,
});

describe("runOutcome", () => {
  it("records what the run saw beside its verdict", () => {
    const out = runOutcome(
      planned(),
      observed({ failed: ["x (404)", "x (404)"], requests: [`${ORIGIN}/`, "https://e.example/"] }),
      120,
    );
    expect(out).toEqual({
      build: "platformer-web",
      mount: "/",
      browser: "chromium",
      kind: "play",
      status: "fail",
      reason: `requests outside ${ORIGIN}: https://e.example/`,
      ms: 120,
      requests: 2,
      offOrigin: ["https://e.example/"],
      outsideMount: [],
      failed: ["x (404)"],
      serviceWorkers: 1,
      play: platformerPlay,
    });
  });

  it("passes with no reason and keeps the offline and context-loss fields", () => {
    const offline = runOutcome(planned({ kind: "offline" }), observed({ controlled: true }), 5);
    expect(offline.status).toBe("pass");
    expect(offline).not.toHaveProperty("reason");
    expect(offline.controlled).toBe(true);
    const loss = runOutcome(
      planned({ kind: "context-loss" }),
      observed({ contextLoss: restoredLoss }),
      5,
    );
    expect(loss.contextLoss).toEqual(restoredLoss);
  });
});

describe("launchFailures", () => {
  const runs = [
    planned({ browser: "webkit" }),
    planned({ browser: "webkit", build: "tactics-web" }),
  ];
  const missing = "browserType.launch: Executable doesn't exist at /ms-playwright/webkit/pw_run.sh";

  it("skips a browser that isn't installed locally and fails it in CI", () => {
    const local = launchFailures(runs, missing, false);
    expect(local.map((r) => r.status)).toEqual(["skipped", "skipped"]);
    expect(local[0]!.reason).toMatch(/^not installed; run `.*playwright install webkit`$/);
    expect(launchFailures(runs, missing, true).map((r) => r.status)).toEqual(["fail", "fail"]);
  });

  it("fails any other launch error with its first line", () => {
    const [out] = launchFailures(runs, "boom\nstack", false);
    expect(out).toMatchObject({ status: "fail", reason: "couldn't launch: boom" });
  });
});

const goodBuild = (name: string): BuildOutcome => ({
  name,
  game: name.startsWith("tactics") ? "tactics" : "platformer",
  target: name.endsWith("itch") ? "itch" : "web",
  ok: true,
  release: "f".repeat(64),
  ms: 1,
  bundleCheck: { ok: true, output: "passed" },
});

describe("the report", () => {
  const plan = plannedRuns(SMOKE_BUILDS, ["chromium"]);
  const builds = SMOKE_BUILDS.map((b) => goodBuild(buildName(b)));
  const passed = (p: PlannedRun): RunOutcome => ({
    ...p,
    status: "pass",
    ...(p.kind === "context-loss" ? { contextLoss: restoredLoss } : {}),
  });

  it("passes when every build checked clean and every planned run passed", () => {
    const report = exportSmokeReport(
      { ci: true, browsers: ["chromium"], builds, runs: plan.map(passed) },
      plan,
    );
    expect(report.ok).toBe(true);
    expect(report.pixiRestoredInPlace).toBe(true);
    expect(Object.keys(report)).toEqual([
      "ok",
      "ci",
      "browsers",
      "builds",
      "runs",
      "pixiRestoredInPlace",
    ]);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });

  it("records a rebuilt renderer as not restored in place, and no probe as null", () => {
    const rebuilt = plan.map((p) =>
      p.kind === "context-loss"
        ? { ...passed(p), contextLoss: { ...restoredLoss, rebuilt: true } }
        : passed(p),
    );
    const parts = { ci: true, browsers: ["chromium" as const], builds, runs: rebuilt };
    expect(exportSmokeReport(parts, plan).pixiRestoredInPlace).toBe(false);
    const firefox = plannedRuns(SMOKE_BUILDS, ["firefox"]);
    const ff = exportSmokeReport(
      { ci: true, browsers: ["firefox"], builds, runs: firefox.map(passed) },
      firefox,
    );
    expect(ff.ok).toBe(true);
    expect(ff.pixiRestoredInPlace).toBeNull();
  });

  it("fails on a failed run, a missing run, a failed build or bundle check, or an error", () => {
    const runs = plan.map(passed);
    const base = { ci: true, browsers: ["chromium" as const], builds, runs };
    const failRun = runs.map((r, i) => (i === 2 ? { ...r, status: "fail" as const } : r));
    expect(exportSmokeOk({ ...base, runs: failRun }, plan)).toBe(false);
    expect(exportSmokeOk({ ...base, runs: runs.slice(1) }, plan)).toBe(false);
    expect(exportSmokeOk({ ...base, builds: [{ ...builds[0]!, ok: false }] }, plan)).toBe(false);
    expect(
      exportSmokeOk(
        { ...base, builds: [{ ...builds[0]!, bundleCheck: { ok: false, output: "leak" } }] },
        plan,
      ),
    ).toBe(false);
    expect(exportSmokeOk({ ...base, builds: [{ ...builds[0]!, bundleCheck: null }] }, plan)).toBe(
      false,
    );
    expect(exportSmokeOk({ ...base, builds: [] }, plan)).toBe(false);
    const errored: Omit<ExportSmokeReport, "ok" | "pixiRestoredInPlace"> = { ...base, error: "x" };
    expect(exportSmokeOk(errored, plan)).toBe(false);
    expect(exportSmokeReport(errored, plan).error).toBe("x");
  });

  it("fails when every run was skipped, passes when some were", () => {
    const all = plannedRuns(SMOKE_BUILDS, ["chromium", "webkit"]);
    const skippedAll = all.map((p): RunOutcome => ({ ...p, status: "skipped" }));
    const parts = { ci: false, browsers: ["chromium" as const, "webkit" as const], builds };
    expect(exportSmokeOk({ ...parts, runs: skippedAll }, all)).toBe(false);
    const some = all.map((p) =>
      p.browser === "webkit" ? { ...p, status: "skipped" as const } : passed(p),
    );
    expect(exportSmokeOk({ ...parts, runs: some }, all)).toBe(true);
  });
});
