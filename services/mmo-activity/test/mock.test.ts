import { readFileSync } from "node:fs";

import rigs from "virtual:rigs";
import { expect, test } from "vite-plus/test";

import type { ActivityState } from "../src/api.ts";
import { MockGateway } from "../src/mock.ts";
import { Session } from "../src/session.ts";
import { FakeClock, settle } from "./fakes.ts";
import { goldenCases } from "./golden.ts";

function fixture(name: string): ActivityState {
  return JSON.parse(readFileSync(`${import.meta.dirname}/fixtures/state-${name}.json`, "utf8"));
}

async function boot(name: string) {
  const clock = new FakeClock();
  const gateway = new MockGateway({
    state: fixture(name),
    rigs,
    now: () => clock.now,
    after: clock.after,
  });
  let ids = 0;
  const session = new Session({
    signIn: async () => ({ dev: "mock" }),
    token: () => gateway.token(),
    open: () => gateway.open(),
    instance: "mock",
    viewer: {},
    now: () => clock.now,
    after: clock.after,
    id: () => `intent-${++ids}-abcdef`,
  });
  session.start();
  await settle();
  clock.advance(0);
  await settle();
  return { clock, session };
}

const level3 = goldenCases("rewire").find((c) => c.name === "level-3-full")!;
const log = (name: string) => level3.logs.find((l) => l.name === name)!.log;

test("the mock answers hello with the fixture's state", async () => {
  const { session } = await boot("beat");
  expect(session.link.phase).toBe("open");
  expect(session.state?.machine?.layout).toEqual(fixture("beat").machine?.layout);
});

test("arm, then the kit's own solve log: solved, the beat won, the row moved twice", async () => {
  const { session, clock } = await boot("beat");
  const armed = await session.intent("machine-arm", { machine: { source: "beat" } });
  await settle();
  expect(armed.ok).toBe(true);
  expect(session.state?.machine).toMatchObject({ armed: true, grace: 2000 });
  expect(session.state!.machine!.deadline! - session.state!.machine!.armedAt!).toBe(48_000);
  clock.advance(2000);
  const solved = await session.intent("machine-solve", { machine: { log: log("solve") } });
  await settle();
  expect(solved.machine).toMatchObject({ solved: true, clean: true });
  expect(session.state?.fight).toBeUndefined();
  expect(session.state?.character.version).toBe(9);
  expect(clock.pending).toBeLessThanOrEqual(1);
});

test("half a log is a haywire and the beat stands with a new machine", async () => {
  const { session } = await boot("beat");
  const before = JSON.stringify(session.state!.machine!.layout);
  await session.intent("machine-arm", { machine: { source: "beat" } });
  await settle();
  const reply = await session.intent("machine-solve", { machine: { log: log("cut-short") } });
  await settle();
  expect(reply.machine).toMatchObject({ solved: false, haywire: "alarm" });
  expect(session.state?.fight).toBeDefined();
  expect(session.state?.machine?.armed).toBe(false);
  expect(JSON.stringify(session.state!.machine!.layout)).not.toBe(before);
});

test("nothing but the solve is taken while a machine is armed", async () => {
  const { session } = await boot("beat");
  await session.intent("machine-arm", { machine: { source: "beat" } });
  await settle();
  const reply = await session.intent("press", { option: "smash" });
  expect(reply.refusal?.code).toBe("machine-armed");
});

test("a master's log solves the hidden panel too", async () => {
  const { session } = await boot("master");
  expect(session.state?.machine?.inner).toBeDefined();
  await session.intent("machine-arm", { machine: { source: "beat" } });
  await settle();
  expect(session.state?.machine?.canPass).toBe(true);
  const reply = await session.intent("machine-solve", { machine: { log: log("master") } });
  expect(reply.machine).toMatchObject({ solved: true, master: true });
});

test("a log sent past the countdown and its grace is late whatever it holds", async () => {
  const { session, clock } = await boot("armed");
  const left = session.state!.machine!.deadline! - session.serverNow();
  expect(left).toBe(48_000);
  clock.advance(left + 2000 + 100);
  const reply = await session.intent("machine-solve", { machine: { log: { moves: [] } } });
  expect(reply.machine).toMatchObject({ solved: false, late: true });
});

test("a stale row version is refused with the row's own", async () => {
  const { session } = await boot("bench");
  const first = session.intent("bench-lesson", { machine: { family: "pressure" } });
  const second = session.intent("bench-lesson", { machine: { family: "nope" } });
  expect((await first).ok).toBe(true);
  expect((await second).refusal?.code).toBe("no-lesson");
});
