import { expect, test } from "vite-plus/test";

import type { IntentReply, MachineView, PuzzleLayout, PuzzleMove } from "../src/api.ts";
import type { IntentBody } from "../src/session.ts";
import { DONE, GOING, type Family, type Model, type Status } from "../src/shell/kit.ts";
import type { PartySceneHost, PartyVersion } from "../src/shell/party-registry.ts";
import { Shell } from "../src/shell/shell.ts";
import { settle } from "./fakes.ts";

// A merged machine for the shell's tests: each seat's moves add up on its
// own count, and it is done when every seat's count reaches the goal.
class Tally implements Model {
  counts: number[];
  played: PuzzleMove[] = [];
  constructor(private readonly layout: PuzzleLayout) {
    this.counts = Array.from({ length: layout.seats ?? 1 }, () => 0);
  }
  run(at: number): [Status, number] {
    return [GOING, at];
  }
  apply(m: PuzzleMove): Status {
    this.played.push(m);
    this.counts[m.seat ?? 0]! += m.a;
    return this.counts.every((c) => c >= this.layout.goal) ? DONE : GOING;
  }
  snapshot(): number[] {
    return [...this.counts];
  }
}

function harness(over: Partial<MachineView> = {}, known: PuzzleMove[] = []) {
  const t = { wall: 0, offset: 7_000_000, online: true, line: true };
  const sent: { kind: string; body: IntentBody; answer(r: Partial<IntentReply>): void }[] = [];
  const streamed: PuzzleMove[] = [];
  const hosts: PartySceneHost[] = [];
  let mounted = 0;
  const scene = (host: PartySceneHost) => {
    hosts.push(host);
    mounted++;
    return { frame: () => {}, destroy: () => mounted-- };
  };
  const family: Family = {
    id: "tally",
    start: (l) => new Tally(l),
    mount: (h) => scene(h as PartySceneHost),
  };
  const version: PartyVersion = {
    id: "tally-crew",
    family: "tally",
    start: (l) => new Tally(l),
    mount: scene,
  };
  const machine: MachineView = {
    source: "party",
    family: "tally",
    name: "Tally",
    layout: { family: "tally", size: 0, decoys: 0, start: 0, goal: 0 },
    preview: false,
    armed: false,
    practice: { level: 0, uses: 0, need: 20 },
    seat: 1,
    seats: [
      { seat: 0, name: "Ash", here: true },
      { seat: 1, name: "Bryn", here: true, you: true },
    ],
    ...over,
  };
  const shell = new Shell(
    {
      family,
      version: machine.party ? version : undefined,
      stream: (m) => {
        if (!t.line) return false;
        streamed.push(m);
        return true;
      },
      known: () => known,
      surface: {} as HTMLElement,
      wall: () => t.wall,
      serverNow: () => t.wall + t.offset,
      online: () => t.online,
      intent: (kind, body) =>
        new Promise((resolve) => {
          sent.push({ kind, body, answer: (r) => resolve({ id: "x", ok: true, ...r }) });
        }),
      after: () => () => {},
      beacon: () => {},
      changed: () => {},
    },
    machine,
  );
  return {
    t,
    sent,
    streamed,
    shell,
    machine,
    host: () => hosts.at(-1)!,
    mounted: () => mounted,
    model: () => hosts.at(-1)!.model as Tally,
  };
}

// The same machine once armed: the seat's part and the clock.
function armed(at = 6_999_000, more: Partial<MachineView> = {}): Partial<MachineView> {
  return {
    armed: true,
    armedAt: at,
    deadline: at + 30_000,
    countdown: 30_000,
    grace: 2000,
    party: "tally-crew",
    layout: {
      family: "tally",
      size: 2,
      decoys: 0,
      start: 0,
      goal: 2,
      seats: 2,
      party: "tally-crew",
    },
    ...more,
  };
}

test("a party machine at rest draws no scene: the launch arms it for everyone", async () => {
  const h = harness();
  expect(h.shell.launchable).toBe(true);
  expect(h.mounted()).toBe(0);
  h.shell.launch();
  expect(h.sent.map((s) => [s.kind, s.body])).toEqual([
    ["machine-arm", { machine: { source: "party" } }],
  ]);
  expect(h.shell.phase).toBe("rest");
  h.sent[0]!.answer({ ok: false, refusal: { code: "party-not-seated", message: "not seated" } });
  await settle();
  expect(h.shell.note).toBe("Everyone at the machine must have it open here before it starts.");
});

test("an armed party machine plays on the server's clock with the version's scene and the seat", () => {
  const h = harness(armed());
  expect(h.shell.phase).toBe("play");
  expect(h.mounted()).toBe(1);
  expect(h.host().seat).toBe(1);
  expect(h.host().seats).toBe(2);
  expect(h.host().now()).toBe(1000);
});

test("this seat's moves are streamed, not kept for a solve, and fed with its seat", () => {
  const h = harness(armed());
  h.t.wall = 500;
  expect(h.host().move(1)).toBe(GOING);
  expect(h.streamed).toEqual([{ at: 1500, a: 1 }]);
  expect(h.model().played).toEqual([{ at: 1500, a: 1, seat: 1 }]);
  expect(h.sent).toEqual([]);
});

test("relayed moves are fed to the model but never sent, and a done reading waits on the world", () => {
  const h = harness(armed());
  h.shell.relayed({ at: 200, a: 2 });
  expect(h.model().counts).toEqual([2, 0]);
  h.t.wall = 300;
  h.host().move(2);
  expect(h.shell.looks).toBe(DONE);
  // Nothing ends the play here: the gateway writes the merged solve.
  expect(h.shell.phase).toBe("play");
  expect(h.sent).toEqual([]);
  expect(h.streamed).toHaveLength(1);
});

test("a relayed move stamped behind the model is fed at the model's time", () => {
  const h = harness(armed());
  h.t.wall = 2000;
  h.shell.tick();
  h.shell.relayed({ at: 100, a: 1 });
  expect(h.model().played).toEqual([{ at: 3000, a: 1 }]);
});

test("a machine armed before this screen plays in the merged log the session holds", () => {
  const h = harness(armed(), [
    { at: 100, a: 1 },
    { at: 200, a: 1, seat: 1 },
  ]);
  expect(h.model().counts).toEqual([1, 1]);
});

test("on a return the gateway's log replaces the model's, from rest", () => {
  const h = harness(armed());
  h.host().move(1);
  const before = h.model();
  h.shell.resync([{ at: 50, a: 2 }]);
  expect(h.model()).not.toBe(before);
  expect(h.model().counts).toEqual([2, 0]);
  expect(h.mounted()).toBe(1);
});

test("a move with no line to the gateway is not played here either", () => {
  const h = harness(armed());
  h.t.line = false;
  h.host().move(1);
  expect(h.model().played).toEqual([]);
  expect(h.shell.note).toBe("Reconnecting. That move did not reach the others.");
});

test("at the countdown the screen waits for the world, and the state's result ends it", () => {
  const h = harness(armed());
  h.t.wall = 30_000;
  h.shell.tick();
  expect(h.shell.phase).toBe("sending");
  expect(h.sent).toEqual([]);
  const same = { ...h.machine, ...armed() };
  expect(h.shell.take(same, true, undefined)).toBe("kept");
  expect(h.shell.take(undefined, false, { solved: true, clean: false, at: 9000 })).toBe("kept");
  expect(h.shell.phase).toBe("done");
  expect(h.shell.ending?.result).toMatchObject({ solved: true, at: 9000 });
});

test("a party machine the state drops with no result for this seat is ended untold", () => {
  const h = harness(armed());
  expect(h.shell.take(undefined, false, undefined)).toBe("kept");
  expect(h.shell.phase).toBe("done");
  expect(h.shell.ending).toEqual({ facts: [] });
});

test("a lone delver's fork machine is streamed on the family's own model", () => {
  const h = harness({
    ...armed(),
    source: "fork",
    party: undefined,
    seat: 0,
    seats: [{ seat: 0, name: "Ash", here: true, you: true }],
    layout: { family: "tally", size: 1, decoys: 0, start: 0, goal: 1 },
  });
  h.host().move(1);
  expect(h.streamed).toHaveLength(1);
  expect(h.model().played).toEqual([{ at: 1000, a: 1, seat: 0 }]);
  expect(h.shell.leavable()).toBe(false);
});
