// @vitest-environment happy-dom
import { readFileSync } from "node:fs";

import partyRigs from "virtual:party-rigs";
import type { PartyRig } from "virtual:party-rigs";
import rigs from "virtual:rigs";
import { afterEach, expect, test } from "vite-plus/test";

import type { ActivityState, PuzzleLayout, PuzzleMove } from "../src/api.ts";
import { App } from "../src/app.ts";
import { MockGateway, type MockDeps } from "../src/mock.ts";
import { Session, type MovesEvent } from "../src/session.ts";
import { DONE, GOING, type Model, type Status } from "../src/shell/kit.ts";
import { versionOf, type PartyVersion } from "../src/shell/party-registry.ts";
import { bareNumbers } from "../src/units.ts";
import { windowLine } from "../src/views/party.ts";
import { goodsNames } from "../src/words.ts";
import { FakeClock, settle } from "./fakes.ts";

function fixture(name: string): ActivityState {
  return JSON.parse(readFileSync(`${import.meta.dirname}/fixtures/state-${name}.json`, "utf8"));
}

const open: Session[] = [];
afterEach(() => {
  for (const s of open.splice(0)) s.stop();
  document.body.replaceChildren();
});

// Two hands on one count each: done when every seat has reached the goal.
class Tally implements Model {
  counts: number[];
  constructor(private readonly layout: PuzzleLayout) {
    this.counts = Array.from({ length: layout.seats ?? 1 }, () => 0);
  }
  run(at: number): [Status, number] {
    return [GOING, at];
  }
  apply(m: PuzzleMove): Status {
    this.counts[m.seat ?? 0]! += m.a;
    return this.counts.every((c) => c >= this.layout.goal) ? DONE : GOING;
  }
  snapshot(): number[] {
    return [...this.counts];
  }
}

const tally: PartyVersion = {
  id: "tally-crew",
  family: "lock-dial",
  start: (l) => new Tally(l),
  mount: () => ({ frame: () => {}, destroy: () => {} }),
};

const tallyLayout = (seat?: number): PuzzleLayout => ({
  family: "lock-dial",
  size: 1,
  decoys: 0,
  start: 0,
  goal: 2,
  seats: 2,
  party: "tally-crew",
  ...(seat !== undefined ? { key: [seat] } : {}),
});

const tallyRig: PartyRig = {
  family: "lock-dial",
  seats: 2,
  shape: 0,
  level: 3,
  tier: 1,
  countdown: 30_000,
  layout: tallyLayout(),
  parts: [tallyLayout(0), tallyLayout(1)],
  solve: [
    { at: 0, a: 2 },
    { at: 250, a: 2, seat: 1 },
  ],
};

interface Seat {
  session: Session;
  heard: MovesEvent[];
}

// One mock party and as many screens on it as asked, each its own seat.
async function party(name: string, screens: number, over: Partial<MockDeps> = {}) {
  const clock = new FakeClock();
  const gateway = new MockGateway({
    state: fixture(name),
    rigs,
    now: () => clock.now,
    after: clock.after,
    partyRigs,
    ...over,
  });
  const seats: Seat[] = [];
  let ids = 0;
  for (let i = 0; i < screens; i++) {
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
    open.push(session);
    const heard: MovesEvent[] = [];
    session.onMoves((ev) => heard.push(ev));
    session.start();
    await settle();
    clock.advance(0);
    await settle();
    seats.push({ session, heard });
  }
  return { clock, gateway, seats };
}

// Every "mine" a state holds, wherever it sits.
function mines(st: ActivityState): string[] {
  const out: string[] = [];
  const walk = (x: unknown) => {
    if (!x || typeof x !== "object") return;
    for (const [k, v] of Object.entries(x)) {
      if (k === "mine" && typeof v === "string") out.push(v);
      walk(v);
    }
  };
  walk(st);
  return out;
}

test("several screens on one mock party are its seats, each with its own character", async () => {
  const { seats } = await party("party", 3, { seats: 3 });
  const ids = seats.map((s) => s.session.state?.character.id);
  expect(new Set(ids).size).toBe(3);
  expect(seats.map((s) => s.session.state?.party?.members.find((m) => m.you)?.name)).toEqual([
    "Ash",
    "Bryn",
    "Cole",
  ]);
});

test("no seat's state holds another's pick, and the beat resolves for everyone at once", async () => {
  const { seats } = await party("party", 3, { seats: 3 });
  const [a, b, c] = seats.map((s) => s.session);
  // Bryn picked before the fixture was caught.
  expect(mines(b!.state!)).toEqual(["hold"]);
  expect(mines(a!.state!)).toEqual([]);
  const reply = await a!.intent("party-pick", { option: "strike" });
  await settle();
  expect(reply.ok).toBe(true);
  expect(mines(a!.state!)).toEqual(["strike"]);
  expect(mines(b!.state!)).toEqual(["hold"]);
  expect(mines(c!.state!)).toEqual([]);
  // The others see that Ash has picked, never what.
  const ash = c!.state!.party!.members.find((m) => m.name === "Ash")!;
  expect(ash.picked).toBe(true);
  expect(JSON.stringify(c!.state!.party)).not.toContain("strike");
  expect(c!.state!.party!.beat).toMatchObject({ picked: 2, present: 3, beat: 2 });
  await c!.intent("party-pick", { option: "hold" });
  await settle();
  for (const s of [a!, b!, c!]) {
    expect(s.state!.party!.beat).toMatchObject({ beat: 3, picked: 0 });
    expect(mines(s.state!)).toEqual([]);
    const last = (s.state!.party as { last?: { pressed: { name: string; option: string }[] } })
      .last;
    expect(last?.pressed.map((p) => `${p.name}:${p.option}`)).toEqual([
      "Ash:strike",
      "Bryn:hold",
      "Cole:hold",
    ]);
  }
});

test("a pick is held: it cannot be made twice, and a machine option is not a pick", async () => {
  const { seats } = await party("party-machine", 1, { seats: 2 });
  const s = seats[0]!.session;
  expect((await s.intent("party-pick", { option: "hack" })).refusal?.code).toBe("needs-activity");
  await settle();
  expect((await s.intent("party-pick", { option: "hold" })).ok).toBe(true);
  await settle();
  expect((await s.intent("party-pick", { option: "strike" })).refusal?.code).toBe("bad-arguments");
  await settle();
  expect((await s.intent("party-pick", { option: "back-out" })).refusal?.code).toBe("picked");
});

test("the window counts down from the server's due and gives the cautious pick to whoever has not chosen", async () => {
  const { seats, clock } = await party("party", 2, { seats: 2 });
  const [a] = seats.map((s) => s.session);
  const beat = a!.state!.party!.beat!;
  // Caught twenty seconds into a two-minute window.
  expect(beat.due! - beat.opened!).toBe(120_000);
  expect(beat.due! - a!.serverNow()).toBe(100_000);
  expect(windowLine(beat.due!, a!.serverNow(), "to pick")).toMatch(/^100 s left to pick\./);
  expect(windowLine(beat.due!, beat.due!, "to pick")).toMatch(/^The window has closed/);
  clock.advance(100_000 + 300);
  await settle();
  const last = (a!.state!.party as { last?: { pressed: { name: string; option: string }[] } }).last;
  expect(last?.pressed.map((p) => `${p.name}:${p.option}`)).toEqual(["Ash:hold", "Bryn:hold"]);
  expect(a!.state!.party!.beat?.beat).toBe(3);
});

test("a party machine arms only when every seat is here, then for everyone on the first touch", async () => {
  const deps = { seats: 2, partyRigs: { "tally-crew": [tallyRig] }, versions: () => tally };
  const lone = await party("party-machine", 1, deps);
  const refused = await lone.seats[0]!.session.intent("machine-arm", {
    machine: { source: "party" },
  });
  expect(refused.refusal?.code).toBe("party-not-seated");
  const { seats } = await party("party-machine", 2, deps);
  const [a, b] = seats.map((s) => s.session);
  expect(a!.state!.machine!.seats!.every((s) => s.here)).toBe(true);
  expect((await b!.intent("machine-arm", { machine: { source: "party" } })).ok).toBe(true);
  await settle();
  for (const [i, s] of [a!, b!].entries()) {
    const m = s.state!.machine!;
    expect(m).toMatchObject({ armed: true, party: "tally-crew", seat: i });
    // Each seat is dealt its own part.
    expect(m.layout.key).toEqual([i]);
  }
  expect(a!.state!.machine!.armedAt).toBe(b!.state!.machine!.armedAt);
});

test("moves stream to the other seats as they land, and the merged log is judged once for all", async () => {
  const deps = { seats: 2, partyRigs: { "tally-crew": [tallyRig] }, versions: () => tally };
  const { seats, clock } = await party("party-machine", 2, deps);
  const [a, b] = seats;
  await a!.session.intent("machine-arm", { machine: { source: "party" } });
  await settle();
  clock.advance(400);
  expect(a!.session.move({ at: 400, a: 2 })).toBe(true);
  await settle();
  expect(b!.heard).toEqual([{ kind: "move", move: { at: 400, a: 2 } }]);
  expect(a!.heard).toEqual([]);
  expect(b!.session.partyLog()).toEqual([{ at: 400, a: 2 }]);
  clock.advance(300);
  b!.session.move({ at: 9_999, a: 2 });
  await settle();
  // The gateway's stamp is never later than its own time since arming.
  expect(a!.heard.at(-1)).toEqual({ kind: "move", move: { at: 700, a: 2, seat: 1 } });
  for (const s of [a!, b!]) {
    expect(s.session.state!.machine).toBeUndefined();
    expect(s.session.state!.last?.result).toMatchObject({ solved: true, at: 700 });
    expect(s.session.state!.fight).toBeUndefined();
  }
});

test("a seat that comes back to an armed machine gets its state, then the merged log", async () => {
  const deps = { seats: 2, partyRigs: { "tally-crew": [tallyRig] }, versions: () => tally };
  const { seats, clock } = await party("party-machine", 2, deps);
  const [a, b] = seats;
  await a!.session.intent("machine-arm", { machine: { source: "party" } });
  await settle();
  a!.session.move({ at: 0, a: 1 });
  b!.session.move({ at: 0, a: 1 });
  await settle();
  b!.session.stop();
  b!.session.start();
  await settle();
  clock.advance(0);
  await settle();
  expect(b!.session.state?.machine?.armed).toBe(true);
  expect(b!.heard.at(-1)).toEqual({
    kind: "moves",
    moves: [
      { at: 0, a: 1 },
      { at: 0, a: 1, seat: 1 },
    ],
  });
});

test("scripted teammates play their seats of the rule's solve on the mock's timers", async () => {
  const deps = {
    seats: 2,
    teammates: true,
    partyRigs: { "tally-crew": [tallyRig] },
    versions: () => tally,
  };
  const { seats, clock } = await party("party-machine", 1, deps);
  const a = seats[0]!;
  await a.session.intent("machine-arm", { machine: { source: "party" } });
  await settle();
  clock.advance(1200 + 250);
  await settle();
  expect(a.heard).toEqual([{ kind: "move", move: { at: 1450, a: 2, seat: 1 } }]);
  a.session.move({ at: 1500, a: 2 });
  await settle();
  expect(a.session.state?.last?.result.solved).toBe(true);
});

// The page itself on the mock party.
async function page(name: string, over: Partial<MockDeps> = {}) {
  const clock = new FakeClock();
  const gateway = new MockGateway({
    state: fixture(name),
    rigs,
    now: () => clock.now,
    after: clock.after,
    partyRigs,
    ...over,
  });
  let ids = 0;
  const session = new Session({
    signIn: async () => ({ dev: "mock" }),
    token: () => gateway.token(),
    open: () => gateway.open(),
    instance: "mock",
    viewer: { compact: true },
    now: () => clock.now,
    after: clock.after,
    id: () => `intent-${++ids}-abcdef`,
  });
  open.push(session);
  const root = document.createElement("div");
  document.body.append(root);
  new App(root, session, true);
  session.start();
  await settle();
  clock.advance(0);
  await settle();
  return { root, session, clock };
}

function click(root: Element, label: string): void {
  const b = [...root.querySelectorAll("button")].find((x) => x.textContent?.startsWith(label));
  if (!b) throw new Error(`no button "${label}"`);
  b.click();
}

function room(root: Element, way: string): string {
  return [...root.querySelectorAll(`[data-way="${way}"] text`)]
    .map((t) => t.textContent)
    .join(" | ");
}

test("the floor's hex rooms show each way, Mapper's look ahead, and the vote as it lands", async () => {
  const { root, session } = await page("floor", { seats: 4 });
  expect(root.querySelector(".floor-map")).not.toBeNull();
  expect(room(root, "way-0")).toBe("Flooded stair | Flooded, dark | Next: cramped | 1 vote: Bryn");
  expect(room(root, "way-1")).toBe(
    "Blast door | Armoured | Behind a rewire | Next: dark | 0 votes",
  );
  expect(root.textContent).toContain(
    "Your hoard sense finds what fell here: 3 copper wire, 1 scrap iron.",
  );
  expect(root.textContent).not.toMatch(/of \d+ floors/);
  click(root, "Push on by flooded stair");
  await settle();
  expect(session.state!.floor!.ways![0]!.votes).toBe(2);
  expect(room(root, "way-0")).toBe(
    "Flooded stair | Flooded, dark | Next: cramped | 2 votes: Ash, Bryn",
  );
  expect(root.textContent).toContain("Ash: push on by flooded stair.");
  // Every word on the map carries its unit.
  const goods = goodsNames();
  for (const t of root.querySelectorAll(".floor-map text"))
    expect(bareNumbers(t.textContent ?? "", goods), t.textContent ?? "").toEqual([]);
});

test("the party beat marks who has chosen and shows its window", async () => {
  const { root } = await page("party", { seats: 4 });
  click(root, "Beat");
  const seats = [...root.querySelectorAll(".seats li")];
  expect(seats.map((li) => li.getAttribute("data-picked"))).toEqual([null, "true", null, null]);
  expect(root.querySelector("[data-due]")?.textContent).toMatch(/^100 s left to pick\./);
  expect(root.textContent).toContain("1 of 4 members have chosen.");
  expect(root.textContent).toContain("Likely (about 3 in 4), risks 4 durability.");
  click(root, "Swap in Breach deck");
  await settle();
  expect(root.textContent).not.toContain("Swap in Breach deck");
  click(root, "Strike");
  await settle();
  expect(root.textContent).toContain("Your pick: Strike.");
  expect(root.textContent).toContain("2 of 4 members have chosen.");
});

test("the live hunt shows its pool, the presses as they land and the viewer's share", async () => {
  const { root, session } = await page("hunt");
  expect(root.textContent).toContain("1,240 of 2,000 health left.");
  expect(root.textContent).toContain("your share of the spoils now is 17%");
  click(root, "Strike");
  await settle();
  expect(session.state!.hunt!.health).toBe(1210);
  expect(root.textContent).toContain("Ash (you): 160 health removed, 30 health just now");
  expect(root.textContent).toContain("You have pressed this tick.");
});

test("a staged hunt says who staged it, and its spoils stay where they were staged", async () => {
  const { root } = await page("staged-hunt");
  const panel = root.querySelector(".panel")!;
  expect(panel.querySelector("h2")?.textContent).toBe("Rad-hound cull: Rad-hound");
  expect(panel.querySelector("p")?.textContent).toBe(
    "Staged by staff of Lantern Hall · 80 event points.",
  );
  expect(root.textContent).toContain("(staged · local to Old Rail)");
});

const splitGrid = versionOf("split-grid");

test.skipIf(!splitGrid)(
  "a competing vault is labelled with who staged it, at rest and armed",
  async () => {
    const { root, session } = await page("vault", { seats: 2, teammates: true });
    const head = () => root.querySelector(".machine-head")!.textContent!;
    expect(head()).toContain("In a competing vault: the first crew to solve it takes it.");
    expect(head()).toContain("Staged by staff of Lantern Hall · 60 event points.");
    expect(head()).not.toContain("Behind a way down");
    click(root, "Start it for everyone");
    await settle();
    expect(session.state!.machine).toMatchObject({ armed: true, party: "split-grid" });
    expect(head()).toContain("Staged by staff of Lantern Hall · 60 event points.");
    for (const node of root.querySelectorAll(".machine svg, .machine canvas")) {
      if (node.getAttribute("aria-hidden") === "true") continue;
      expect(node.getAttribute("aria-label")?.trim()).toBeTruthy();
    }
    expect(root.querySelectorAll(".machine svg, .machine canvas").length).toBeGreaterThan(0);
  },
);

const realLock = versionOf("two-hand-lock");

test.skipIf(!realLock)(
  "?mock=party-machine with scripted teammates: the launch starts the real version for every seat",
  async () => {
    const { root, session } = await page("party-machine", { seats: 2, teammates: true });
    expect(root.querySelector(".machine")?.getAttribute("data-phase")).toBe("rest");
    expect(root.textContent).toContain("At the machine: Ash (you); Bryn.");
    click(root, "Start it for everyone");
    await settle();
    const m = session.state!.machine!;
    expect(m).toMatchObject({ armed: true, party: "two-hand-lock", seat: 0 });
    expect(root.querySelector(".machine")?.getAttribute("data-phase")).toBe("play");
    expect(root.textContent).toContain("Armed for everyone.");
  },
);
