// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { SIGNED_IN_SAVES_DESCRIBE } from "@/lib/engine/local-saves";

import {
  frameOutsideRelease,
  judgeClaim,
  judgeLive,
  judgeOwnSaves,
  LIVE_APPLY_MS,
  LIVE_POLL_MS,
  LIVE_SMOKE_TIMING,
  liveDeadlineMs,
  playRequestScope,
  PROBE_PARAM,
  SAVED_BANNER,
  SAVED_NOTE,
  type ClaimProbe,
  type HostProbe,
  type LiveRunProbe,
  type OwnSavesProbe,
  type PlayScope,
} from "../play-frame";

const quietHost: HostProbe = {
  states: ["ready"],
  issues: [],
  dropped: 0,
  frameSaves: [],
  storeCalls: [],
};

const ownSaves: OwnSavesProbe = {
  note: SAVED_NOTE,
  written: 1,
  stored: true,
  declaredReached: true,
  undeclaredBlocked: true,
  undeclaredReceived: 0,
  undeclaredViolation: true,
};

const claim: ClaimProbe = {
  note: SAVED_NOTE,
  localBefore: 1,
  signedIn: true,
  rows: [{ slot: "1", ticked: true, collides: false }],
  results: [{ slot: "1", ok: true }],
  localAfter: 0,
  accountSaves: 1,
  second: {
    signedIn: true,
    localRecords: 0,
    menuNote: SIGNED_IN_SAVES_DESCRIBE,
    continued: SAVED_BANNER,
  },
};

describe("playRequestScope", () => {
  const scope: PlayScope = {
    release: "http://127.0.0.1:4000/r/abc/",
    hostOrigin: "http://localhost:5000",
    hostFiles: new Set(["/play-host.html"]),
    hostPaths: ["/api/engine/saves"],
    connect: ["https://127.0.0.1:6000"],
  };

  it("places the host's routes and the game's declared origin in scope", () => {
    expect(playRequestScope("http://localhost:5000/api/engine/saves/p1", scope)).toBe("host-page");
    expect(playRequestScope("https://127.0.0.1:6000/save?x=1", scope)).toBe("game-server");
    expect(playRequestScope("http://127.0.0.1:4000/r/abc/index.html", scope)).toBe("release");
  });

  it("keeps everything else outside", () => {
    expect(playRequestScope("http://localhost:5000/api/auth/session", scope)).toBe("outside");
    expect(playRequestScope("https://127.0.0.1:6001/save", scope)).toBe("outside");
    expect(
      playRequestScope("http://localhost:5000/api/engine/saves", {
        ...scope,
        hostPaths: undefined,
      }),
    ).toBe("outside");
  });
});

describe("judgeOwnSaves", () => {
  it("passes a save that only reached the game's own server", () => {
    expect(judgeOwnSaves(ownSaves, quietHost)).toEqual([]);
  });

  it("fails when the host heard saves or an undeclared origin was reached", () => {
    const reasons = judgeOwnSaves(
      { ...ownSaves, undeclaredBlocked: false, undeclaredReceived: 2 },
      { ...quietHost, frameSaves: ["saves.write", "saves.write"], storeCalls: ["list"] },
    );
    expect(reasons).toEqual([
      "the frame sent the host saves.write",
      "the host's save store was called: list",
      "a fetch to an undeclared origin went through",
      "an undeclared origin received 2 request(s) from the frame",
    ]);
  });

  it("names a missing run and a save the server didn't keep", () => {
    expect(judgeOwnSaves(undefined, quietHost)).toEqual(["the own-saves run didn't finish"]);
    expect(judgeOwnSaves({ ...ownSaves, stored: false }, quietHost)).toEqual([
      "the game's own save server holds no save file for it",
    ]);
  });
});

describe("judgeClaim", () => {
  it("passes a claimed save read back in a second context", () => {
    expect(judgeClaim(claim)).toEqual([]);
  });

  it("fails a refused claim that left the save in this browser", () => {
    const reasons = judgeClaim({
      ...claim,
      results: [{ slot: "1", ok: false, message: "No room." }],
      localAfter: 1,
      accountSaves: 0,
    });
    expect(reasons).toEqual([
      "claiming 1 was refused: No room.",
      "this browser still holds 1 save record(s) after the claim",
      "the account holds no save after the claim",
    ]);
  });

  it("fails a second context that read its own storage", () => {
    const reasons = judgeClaim({
      ...claim,
      second: { signedIn: true, localRecords: 1, menuNote: "x", continued: null },
    });
    expect(reasons).toHaveLength(3);
    expect(judgeClaim({ ...claim, second: null })).toEqual([
      "the second browser context didn't run",
    ]);
  });
});

const VERSION = "a".repeat(64);
const DIR = "http://127.0.0.1:4000/frames/p/r1/";

const liveRun: LiveRunProbe = {
  payloadVersion: 1,
  initialScenes: 0,
  client: true,
  stream: true,
  streamRequests: 1,
  reads: 1,
  moved: null,
  published: { versionId: VERSION, number: 1, created: true, uploaded: 1, scene: "level-1" },
  appliedMs: 800,
  states: [
    {
      scene: "level-1",
      version: VERSION,
      status: "applied",
      timing: LIVE_SMOKE_TIMING,
      strategy: "reconcile",
      at: 0,
    },
  ],
  frameLiveMessages: 1,
  swaps: [{ version: VERSION, timing: LIVE_SMOKE_TIMING }],
  restarted: [],
  liveFetched: true,
  liveRequests: 1,
  frameOutside: [],
  route: { compatible: 200, foreignCompat: 404, otherProject: 404 },
};

const pinnedRun: LiveRunProbe = {
  ...liveRun,
  initialScenes: null,
  client: false,
  stream: false,
  streamRequests: 0,
  frameLiveMessages: 0,
  liveRequests: 0,
  pointed: true,
};

describe("live runs", () => {
  it("gives the poll run one poll interval more than the stream", () => {
    expect(liveDeadlineMs("live-stream")).toBe(LIVE_APPLY_MS);
    expect(liveDeadlineMs("live-poll")).toBe(LIVE_POLL_MS + LIVE_APPLY_MS);
  });

  it("finds the frame's requests outside its release's directory", () => {
    expect(
      frameOutsideRelease(
        [
          `${DIR}index.html`,
          `${DIR}live/${VERSION}.json`,
          "data:image/png;base64,AA",
          "blob:http://127.0.0.1:4000/x",
          `http://127.0.0.1:4000/frames/p/r2/live/${VERSION}.json`,
          `http://127.0.0.1:4000/frames/p/r2/live/${VERSION}.json`,
          `http://127.0.0.1:4000/anything?${PROBE_PARAM}=1`,
          "not a url",
        ],
        DIR,
      ),
    ).toEqual([`http://127.0.0.1:4000/frames/p/r2/live/${VERSION}.json`, "not a url"]);
  });

  it("passes a clean stream swap and a clean pinned run", () => {
    expect(judgeLive("live-stream", liveRun)).toEqual([]);
    expect(judgeLive("live-pinned", pinnedRun)).toEqual([]);
  });

  it("fails a run that never finished", () => {
    expect(judgeLive("live-stream", undefined)).toEqual(["the live run didn't finish"]);
  });

  it("puts reads outside the release first", () => {
    const reasons = judgeLive("live-stream", { ...liveRun, frameOutside: ["http://x/y"] });
    expect(reasons).toEqual(["the frame read outside its release's directory: http://x/y"]);
  });

  it("fails a stream swap that applied late, by replacing, or never surfaced", () => {
    const first = liveRun.states[0]!;
    const reasons = judgeLive("live-stream", {
      ...liveRun,
      appliedMs: LIVE_APPLY_MS + 1,
      states: [{ ...first, strategy: "replace" }],
      swaps: [],
    });
    expect(reasons).toHaveLength(3);
    expect(reasons[0]).toContain(`with the stream it must within ${LIVE_APPLY_MS} ms`);
    expect(reasons[1]).toContain("not reconcile");
    expect(reasons[2]).toContain("didn't surface the swap");
  });

  it("allows the poll run its longer deadline but no stream", () => {
    const poll: LiveRunProbe = {
      ...liveRun,
      stream: false,
      streamRequests: 0,
      route: undefined,
      appliedMs: LIVE_POLL_MS + 1,
    };
    expect(judgeLive("live-poll", poll)).toEqual([]);
    expect(judgeLive("live-poll", { ...poll, stream: true })).toEqual([
      "the play page still had an EventSource with the stream off",
    ]);
  });

  it("names a refused version once, without a deadline reason", () => {
    const first = liveRun.states[0]!;
    const reasons = judgeLive("live-stream", {
      ...liveRun,
      appliedMs: null,
      states: [{ ...first, status: "refused", issue: { code: "compat", message: "no" } }],
    });
    expect(reasons).toEqual([
      `the frame reported level-1@${VERSION.slice(0, 12)} refused (compat: no)`,
    ]);
  });

  it("fails a numbered play that took the pointer's version", () => {
    const reasons = judgeLive("live-pinned", {
      ...pinnedRun,
      client: true,
      frameLiveMessages: 2,
      liveRequests: 1,
    });
    expect(reasons).toEqual([
      "the numbered play started the live client",
      "the frame sent 2 live.state message(s) in a numbered play",
      "the frame read 1 live file(s) in a numbered play",
    ]);
  });
});
