import { expect, test } from "vite-plus/test";

import type { IntentReply, MachineView, PuzzleLayout, PuzzleMove } from "../src/api.ts";
import type { IntentBody } from "../src/session.ts";
import {
  BROKE,
  DONE,
  GOING,
  type Family,
  type Model,
  type SceneHost,
  type Status,
} from "../src/shell/kit.ts";
import { Shell } from "../src/shell/shell.ts";
import { settle } from "./fakes.ts";

// A machine for the shell's tests: moves add up to the goal, a negative
// move breaks it, and with a range it breaks by itself at that ms. With a
// step, a move is a swipe that took step ms a unit and must fit the time
// since the last one.
class Sum implements Model {
  total = 0;
  ran = 0;
  last = 0;
  constructor(private readonly layout: PuzzleLayout) {}
  run(at: number): [Status, number] {
    this.ran = at;
    const dies = this.layout.range ?? 0;
    return dies > 0 && at >= dies ? [BROKE, dies] : [GOING, at];
  }
  apply(m: PuzzleMove): Status {
    if (m.a < 0) return BROKE;
    if (m.a * (this.layout.step ?? 0) > m.at - this.last) return BROKE;
    this.last = m.at;
    this.total += m.a;
    return this.total >= this.layout.goal ? DONE : GOING;
  }
  snapshot(): number[] {
    return [this.total, this.ran];
  }
}

interface Sent {
  kind: string;
  body: IntentBody;
  answer(reply: Partial<IntentReply>): void;
}

function harness(over: Partial<MachineView> = {}, layout: Partial<PuzzleLayout> = {}) {
  const t = { wall: 0, offset: 7_000_000, online: true };
  const sent: Sent[] = [];
  const hosts: SceneHost[] = [];
  const frames: number[] = [];
  const timers: (() => void)[] = [];
  const beacons: { event: string; data: Record<string, string | number | boolean> }[] = [];
  let mounted = 0;
  const family: Family = {
    id: "sum",
    start: (l) => new Sum(l),
    mount(host) {
      hosts.push(host);
      mounted++;
      return {
        frame: (at) => frames.push(at),
        destroy: () => mounted--,
      };
    },
  };
  const machine: MachineView = {
    source: "beat",
    family: "sum",
    name: "Sum",
    layout: { family: "sum", size: 1, decoys: 0, start: 0, goal: 3, ...layout },
    preview: false,
    armed: false,
    practice: { level: 0, uses: 0, need: 20 },
    ...over,
  };
  const shell = new Shell(
    {
      family,
      surface: {} as HTMLElement,
      wall: () => t.wall,
      serverNow: () => t.wall + t.offset,
      online: () => t.online,
      intent: (kind, body) =>
        new Promise((resolve) => {
          sent.push({
            kind,
            body,
            answer: (reply) => resolve({ id: "x", ok: true, ...reply }),
          });
        }),
      after: (_ms, f) => {
        timers.push(f);
        return () => timers.splice(timers.indexOf(f), 1);
      },
      beacon: (event, data) => beacons.push({ event, data }),
      changed: () => {},
    },
    machine,
  );
  // What the server says of the machine once armed, a round trip after the touch.
  const armed = (lag = 40, countdown = 40_000): MachineView => {
    const armedAt = t.wall + t.offset - lag;
    return {
      ...machine,
      armed: true,
      armedAt,
      deadline: armedAt + countdown,
      grace: 2000,
      countdown,
      level: 1,
    };
  };
  return {
    t,
    sent,
    hosts,
    frames,
    timers,
    beacons,
    shell,
    machine,
    armed,
    host: () => hosts.at(-1)!,
    mounted: () => mounted,
    model: () => hosts.at(-1)!.model as Sum,
  };
}

test("at rest the scene is drawn once at 0 and nothing is sent", () => {
  const h = harness();
  expect(h.shell.phase).toBe("rest");
  expect(h.frames).toEqual([0]);
  h.t.wall = 60_000;
  h.shell.tick();
  expect(h.host().now()).toBe(0);
  expect(h.shell.left()).toBeUndefined();
  expect(h.sent).toEqual([]);
});

test("the first move arms: the clock starts and the arm goes out at once", () => {
  const h = harness({ compact: true });
  h.t.wall = 5000;
  expect(h.host().move(1)).toBe(GOING);
  expect(h.shell.phase).toBe("play");
  expect(h.sent.map((s) => [s.kind, s.body])).toEqual([
    ["machine-arm", { machine: { source: "beat", pouch: undefined, compact: true } }],
  ]);
  h.t.wall = 5400;
  expect(h.host().now()).toBe(400);
  h.host().move(1);
  expect(h.sent).toHaveLength(1);
});

test("a refused arm puts the scene back at rest with the refusal shown", async () => {
  const h = harness();
  h.host().move(1);
  const first = h.model();
  h.sent[0]!.answer({ ok: false, refusal: { code: "locked-down", message: "locked" } });
  await settle();
  expect(h.shell.phase).toBe("rest");
  expect(h.shell.note).toBe("This machine has locked you out for now.");
  expect(h.model()).not.toBe(first);
  expect(h.model().total).toBe(0);
  expect(h.host().now()).toBe(0);
  expect(h.mounted()).toBe(1);
});

test("a log sent before its arm was refused is forgotten with it", async () => {
  const h = harness();
  h.host().move(3);
  expect(h.shell.phase).toBe("sending");
  h.sent[0]!.answer({ ok: false, refusal: { code: "no-machine", message: "gone" } });
  await settle();
  h.sent[1]!.answer({ ok: false, refusal: { code: "no-machine", message: "gone" } });
  await settle();
  expect(h.shell.phase).toBe("rest");
  expect(h.shell.ending).toBeUndefined();
});

test("the log is sent when the model is done, and the result is the server's", async () => {
  const h = harness();
  h.t.wall = 1000;
  h.host().move(1);
  h.t.wall = 1250;
  h.host().move(2);
  expect(h.shell.phase).toBe("sending");
  expect(h.sent[1]).toMatchObject({
    kind: "machine-solve",
    body: {
      machine: {
        log: {
          moves: [
            { at: 0, a: 1 },
            { at: 250, a: 2 },
          ],
          end: 250,
        },
      },
    },
  });
  // The mirror thinks it is solved; only the reply says what it was.
  expect(h.shell.ending).toBeUndefined();
  h.sent[1]!.answer({ machine: { solved: true, clean: true, at: 250 } });
  await settle();
  expect(h.shell.phase).toBe("done");
  expect(h.shell.ending?.result).toEqual({ solved: true, clean: true, at: 250 });
});

test("the log is sent when the model breaks on a move", () => {
  const h = harness();
  h.host().move(1);
  h.t.wall = 300;
  expect(h.host().move(-1)).toBe(BROKE);
  expect(h.sent[1]).toMatchObject({
    kind: "machine-solve",
    body: {
      machine: {
        log: {
          moves: [
            { at: 0, a: 1 },
            { at: 300, a: -1 },
          ],
          end: 300,
        },
      },
    },
  });
});

test("the log is sent when the model breaks by itself, at the ms it broke", () => {
  const h = harness({}, { range: 900 });
  h.host().move(1);
  h.t.wall = 1000;
  h.shell.tick();
  expect(h.shell.phase).toBe("sending");
  expect(h.sent[1]!.body.machine?.log).toEqual({ moves: [{ at: 0, a: 1 }], end: 900 });
});

test("the countdown is read from the server's deadline, and the log goes when it ends here", () => {
  const h = harness();
  h.t.wall = 2000;
  h.host().move(1);
  h.t.wall = 2100;
  h.shell.update(h.armed(60));
  expect(h.shell.acked).toBe(true);
  expect(h.shell.left()).toBe(40_000 - 60);
  h.t.wall = 2000 + 30_000;
  h.shell.tick();
  expect(h.shell.left()).toBe(10_040);
  expect(h.shell.phase).toBe("play");
  h.t.wall = 2000 + 40_040;
  h.shell.tick();
  expect(h.shell.left()).toBe(0);
  expect(h.shell.phase).toBe("sending");
  expect(h.sent[1]!.body.machine?.log).toEqual({ moves: [{ at: 0, a: 1 }], end: 40_040 });
});

test("a machine armed before the page loaded runs from rest to the elapsed ms", () => {
  const t0 = 7_000_000;
  const h = harness({
    armed: true,
    armedAt: t0 - 12_000,
    deadline: t0 + 28_000,
    grace: 2000,
    countdown: 40_000,
  });
  expect(h.shell.phase).toBe("play");
  expect(h.sent).toEqual([]);
  h.shell.tick();
  expect(h.model().ran).toBe(12_000);
  expect(h.host().now()).toBe(12_000);
  expect(h.shell.left()).toBe(28_000);
  // New moves are stamped from the server's arming, and nothing is armed twice.
  h.t.wall = 500;
  h.host().move(3);
  expect(h.sent.map((s) => s.kind)).toEqual(["machine-solve"]);
  expect(h.sent[0]!.body.machine?.log).toEqual({ moves: [{ at: 12_500, a: 3 }], end: 12_500 });
});

test("a machine that breaks unattended after a reload is sent as it stands", () => {
  const t0 = 7_000_000;
  const h = harness(
    { armed: true, armedAt: t0 - 5000, deadline: t0 + 35_000, grace: 2000, countdown: 40_000 },
    { range: 900 },
  );
  h.shell.tick();
  expect(h.shell.phase).toBe("sending");
  expect(h.sent[0]!.body.machine?.log).toEqual({ moves: [], end: 900 });
});

test("a clock that ran well ahead of the server's arming is moved back onto it", () => {
  const h = harness();
  h.host().move(1);
  h.t.wall = 1500;
  h.host().move(1);
  // The arm took three seconds to land: stamps that far ahead would be replayed as late.
  h.t.wall = 3200;
  h.shell.update(h.armed(200));
  expect(h.host().now()).toBe(200);
  expect(h.model().total).toBe(2);
  h.t.wall = 3300;
  h.host().move(1);
  expect(h.sent[1]!.body.machine?.log).toEqual({
    moves: [
      { at: 0, a: 1 },
      { at: 0, a: 1 },
      { at: 300, a: 1 },
    ],
    end: 300,
  });
});

test("a scene can start the clock with no move, and the arm goes out once", () => {
  const h = harness();
  h.host().arm();
  expect(h.shell.phase).toBe("play");
  expect(h.sent.map((s) => s.kind)).toEqual(["machine-arm"]);
  h.t.wall = 700;
  h.host().arm();
  expect(h.host().now()).toBe(700);
  h.host().move(3);
  expect(h.sent.map((s) => s.kind)).toEqual(["machine-arm", "machine-solve"]);
  expect(h.sent[1]!.body.machine?.log).toEqual({ moves: [{ at: 700, a: 3 }], end: 700 });
});

test("a move that only breaks by being moved back keeps its own stamp", () => {
  const h = harness({}, { step: 500 });
  h.host().arm();
  // A swipe timed from the first touch: it fits the clock it was made on.
  h.t.wall = 500;
  h.host().move(1);
  h.t.wall = 3000;
  h.host().move(1);
  // The arm took 1.5 s to land. Moved back, the first swipe would not fit.
  h.t.wall = 3100;
  h.shell.update(h.armed(1600));
  expect(h.shell.phase).toBe("play");
  expect(h.model().total).toBe(2);
  h.t.wall = 4100;
  h.host().move(1);
  expect(h.sent[1]!.body.machine?.log).toEqual({
    moves: [
      { at: 500, a: 1 },
      { at: 1500, a: 1 },
      { at: 2600, a: 1 },
    ],
    end: 2600,
  });
});

test("a log finished before a slow arm landed is moved back before it is sent", () => {
  const h = harness();
  h.host().move(1);
  h.t.wall = 1800;
  h.host().move(2);
  expect(h.shell.phase).toBe("sending");
  const log = h.sent[1]!.body.machine!.log!;
  expect(log).toEqual({
    moves: [
      { at: 0, a: 1 },
      { at: 1800, a: 2 },
    ],
    end: 1800,
  });
  // The server armed 2.6 s after the first touch.
  h.t.wall = 2700;
  h.shell.update(h.armed(100));
  expect(log).toEqual({
    moves: [
      { at: 0, a: 1 },
      { at: 0, a: 2 },
    ],
    end: 0,
  });
});

test("a clock a little ahead is left alone: the grace covers it", () => {
  const h = harness();
  h.host().move(1);
  h.t.wall = 400;
  h.shell.update(h.armed(100));
  expect(h.host().now()).toBe(400);
});

test("the first touch does not arm into a dead line", () => {
  const h = harness();
  h.t.online = false;
  expect(h.host().move(1)).toBe(GOING);
  expect(h.shell.phase).toBe("rest");
  expect(h.shell.note).toContain("Reconnecting");
  expect(h.sent).toEqual([]);
  expect(h.model().total).toBe(0);
});

test("a locked machine does not arm", () => {
  const h = harness({ locked: 30 });
  h.host().move(1);
  expect(h.shell.phase).toBe("rest");
  expect(h.sent).toEqual([]);
});

test("a master's solve opens the hidden panel, on its own clock, in the same log", async () => {
  const inner = { family: "sum", size: 1, decoys: 0, start: 0, goal: 2 };
  const h = harness({ inner, guide: { at: 0, a: 3 }, hints: [{ at: 0, a: 3 }] });
  expect(h.host().guide).toEqual({ at: 0, a: 3 });
  h.t.wall = 100;
  h.host().move(3);
  expect(h.shell.phase).toBe("play");
  expect(h.shell.panel).toBe(1);
  expect(h.hosts).toHaveLength(2);
  expect(h.mounted()).toBe(1);
  expect(h.host().layout).toBe(inner);
  expect(h.host().guide).toBeUndefined();
  expect(h.shell.hintsLeft()).toBe(0);
  h.t.wall = 900;
  expect(h.host().now()).toBe(800);
  h.host().move(2);
  expect(h.sent[1]!.body.machine?.log).toEqual({
    moves: [
      { at: 0, a: 3 },
      { at: 800, a: 2 },
    ],
    end: 800,
  });
  h.sent[1]!.answer({ machine: { solved: true, clean: true, master: true, at: 0 } });
  await settle();
  expect(h.shell.ending?.result?.master).toBe(true);
});

test("a hidden panel can be left, and a failed one still sends the solve", () => {
  const inner = { family: "sum", size: 1, decoys: 0, start: 0, goal: 2 };
  const left = harness({ inner });
  expect(left.shell.leavable()).toBe(false);
  left.host().move(3);
  expect(left.shell.leavable()).toBe(true);
  left.t.wall = 700;
  left.shell.leave();
  expect(left.sent[1]!.body.machine?.log).toEqual({ moves: [{ at: 0, a: 3 }], end: 700 });

  const broke = harness({ inner });
  broke.host().move(3);
  broke.t.wall = 200;
  broke.host().move(-1);
  expect(broke.sent[1]!.kind).toBe("machine-solve");
});

test("hints come one at a time, as many as the state sent", () => {
  const h = harness({
    hints: [
      { at: 0, a: 1 },
      { at: 0, a: 2 },
    ],
  });
  expect(h.shell.hintsLeft()).toBe(2);
  expect(h.host().hinted()).toBeUndefined();
  h.shell.hint();
  expect(h.host().hinted()).toEqual({ at: 0, a: 1 });
  h.shell.hint();
  h.shell.hint();
  expect(h.host().hinted()).toEqual({ at: 0, a: 2 });
  expect(h.shell.hintsLeft()).toBe(0);
  h.shell.showHint({ at: 0, a: 9 });
  expect(h.host().hinted()).toEqual({ at: 0, a: 9 });
});

test("a hint is lit on the shell's clock and goes out by it", () => {
  const h = harness({ hints: [{ at: 0, a: 1 }] });
  h.shell.hint();
  h.t.wall = 3000;
  expect(h.host().hinted()).toEqual({ at: 0, a: 1 });
  h.t.wall = 3001;
  expect(h.host().hinted()).toBeUndefined();
});

test("a master may pass the move the server states once the machine is armed", () => {
  const h = harness({ hints: [{ at: 0, a: 1 }], canPass: true, pass: { at: 0, a: 1 } });
  expect(h.shell.passable()).toBeUndefined();
  h.host().move(1);
  expect(h.shell.passable()).toEqual({ at: 0, a: 1 });
  h.shell.update({ ...h.shell.machine, canPass: false, pass: undefined });
  expect(h.shell.passable()).toBeUndefined();
});

test("a bench rig has no countdown and no arming: the whole log goes as a bench solve", async () => {
  const h = harness({ source: "bench", level: 4, compact: true });
  h.t.online = false;
  h.host().move(1);
  expect(h.shell.phase).toBe("play");
  expect(h.sent).toEqual([]);
  expect(h.shell.left()).toBeUndefined();
  h.t.wall = 90_000;
  h.shell.tick();
  expect(h.shell.phase).toBe("play");
  h.shell.teach = true;
  h.host().move(2);
  expect(h.sent).toHaveLength(1);
  expect(h.sent[0]).toMatchObject({
    kind: "bench-solve",
    body: {
      machine: {
        source: "bench",
        family: "sum",
        level: 4,
        compact: true,
        teach: true,
        log: {
          moves: [
            { at: 0, a: 1 },
            { at: 90_000, a: 2 },
          ],
          end: 90_000,
        },
      },
    },
  });
  h.sent[0]!.answer({ machine: { solved: true, clean: false, at: 90_000 } });
  await settle();
  expect(h.shell.ending?.result?.solved).toBe(true);
});

test("a bench rig can be given up: the unfinished log asks for another", () => {
  const h = harness({ source: "bench", level: 2 });
  h.host().move(1);
  h.t.wall = 4000;
  h.shell.leave();
  expect(h.sent[0]!.body.machine?.log).toEqual({ moves: [{ at: 0, a: 1 }], end: 4000 });
});

test("when the server's own timer ends the machine, its result is shown", async () => {
  const h = harness();
  h.host().move(1);
  h.shell.update(h.armed());
  h.shell.conclude({ solved: false, clean: false, late: true, at: 0, haywire: "alarm" });
  expect(h.shell.phase).toBe("done");
  expect(h.shell.ending?.result?.haywire).toBe("alarm");
  // Frozen: time no longer runs on the scene.
  h.t.wall = 9000;
  expect(h.host().now()).toBe(0);
});

test("a solve the server's timer beat keeps the ending the state told", async () => {
  const h = harness();
  h.host().move(3);
  h.shell.update(h.armed());
  h.shell.conclude({ solved: false, clean: false, late: true, at: 0, haywire: "alarm" });
  h.sent[1]!.answer({ ok: false, refusal: { code: "no-machine", message: "gone" } });
  await settle();
  expect(h.shell.ending?.result?.late).toBe(true);
  expect(h.shell.ending?.refusal).toBeUndefined();
});

test("a reply that follows the state adds its facts to the ending", async () => {
  const h = harness();
  h.host().move(3);
  h.shell.update(h.armed());
  h.shell.conclude({ solved: true, clean: true, at: 0 });
  h.sent[1]!.answer({
    machine: { solved: true, clean: true, at: 0 },
    facts: [{ id: 1, tick: 1, kind: "puzzle.solved", subjects: [], data: [], weight: 5 }],
  });
  await settle();
  expect(h.shell.ending?.facts).toHaveLength(1);
});

test("a refused log is shown as refused, not as a result", async () => {
  const h = harness();
  h.host().move(3);
  h.sent[1]!.answer({
    ok: false,
    refusal: { code: "banned", message: "This character is banned." },
  });
  await settle();
  expect(h.shell.phase).toBe("done");
  expect(h.shell.ending).toMatchObject({ result: undefined, refusal: { code: "banned" } });
});

test("a solve the world could not take goes again as it is until it is answered", async () => {
  const h = harness();
  h.host().move(3);
  h.shell.update(h.armed());
  const log = h.sent[1]!.body.machine?.log;
  h.sent[1]!.answer({ ok: false, refusal: { code: "internal", message: "try again" } });
  await settle();
  expect(h.shell.phase).toBe("sending");
  expect(h.timers).toHaveLength(1);
  h.timers.shift()!();
  expect(h.sent[2]!.kind).toBe("machine-solve");
  expect(h.sent[2]!.body.machine?.log).toEqual(log);
  h.sent[2]!.answer({ machine: { solved: true, clean: true, at: 0 } });
  await settle();
  expect(h.shell.phase).toBe("done");
  expect(h.shell.ending?.result?.solved).toBe(true);
  expect(h.shell.ending?.refusal).toBeUndefined();
});

test("a solve is not sent again once the server would no longer take it", async () => {
  const h = harness();
  h.host().move(3);
  const armed = h.armed();
  h.shell.update({ ...armed, due: armed.deadline! + armed.grace! });
  h.t.wall += 60_000;
  h.sent[1]!.answer({ ok: false, refusal: { code: "busy", message: "too many" } });
  await settle();
  expect(h.shell.phase).toBe("done");
  expect(h.shell.ending?.refusal?.code).toBe("busy");
  expect(h.timers).toHaveLength(0);
});

test("a bench solve the world could not take goes again; one on a moved row is the session's", async () => {
  const h = harness({ source: "bench", level: 2, maxPlay: 600_000 });
  h.host().move(3);
  expect(h.sent[0]!.kind).toBe("bench-solve");
  h.sent[0]!.answer({ ok: false, refusal: { code: "busy", message: "too many" } });
  await settle();
  expect(h.shell.phase).toBe("sending");
  h.timers.shift()!();
  expect(h.sent[1]!.kind).toBe("bench-solve");
  h.sent[1]!.answer({ ok: false, refusal: { code: "stale", message: "moved" } });
  await settle();
  expect(h.shell.phase).toBe("done");
  expect(h.timers).toHaveLength(0);
});

test("a bench rig is given up when it has been played as long as one may be", () => {
  const h = harness({ source: "bench", level: 2, maxPlay: 600_000 });
  h.host().move(1);
  h.t.wall = 599_999;
  h.shell.tick();
  expect(h.shell.phase).toBe("play");
  h.t.wall = 600_000;
  h.shell.tick();
  expect(h.shell.phase).toBe("sending");
  expect(h.sent[0]!.kind).toBe("bench-solve");
  expect(h.shell.note).not.toBe("");
});

test("touches that missed are reported as one summary, not one each", () => {
  const h = harness();
  const ev = { pointerType: "touch" } as PointerEvent;
  h.host().move(1);
  h.host().dropped(10, 30, true, ev);
  h.host().dropped(50, 30, false, ev);
  expect(h.beacons).toEqual([]);
  h.t.wall = 5000;
  h.shell.tick();
  expect(h.beacons).toEqual([
    {
      event: "drop",
      data: {
        family: "sum",
        touches: 2,
        landed: 1,
        missPx: 30,
        worstPx: 50,
        hitPx: 30,
        pointer: "touch",
      },
    },
  ]);
  h.host().dropped(4, 30, true, ev);
  h.host().move(2);
  expect(h.beacons).toHaveLength(2);
});

test("moves after the play has ended are dropped", () => {
  const h = harness();
  h.host().move(3);
  h.host().move(1);
  expect(h.sent[1]!.body.machine?.log?.moves).toHaveLength(1);
});
