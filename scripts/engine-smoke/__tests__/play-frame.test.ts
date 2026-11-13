// @vitest-environment node
import { describe, expect, it } from "vite-plus/test";

import { SIGNED_IN_SAVES_DESCRIBE } from "@/lib/engine/local-saves";

import {
  judgeClaim,
  judgeOwnSaves,
  playRequestScope,
  SAVED_BANNER,
  SAVED_NOTE,
  type ClaimProbe,
  type HostProbe,
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
