import { expect, test } from "vite-plus/test";

import { SignInError } from "../src/discord.ts";
import { rig, settle, stateAt } from "./fakes.ts";

test("signs in, says hello with the session and never a credential in the URL", async () => {
  const r = rig();
  r.session.start();
  await settle();
  expect(r.tokens).toEqual([{ dev: "d-1" }]);
  expect(r.session.link.phase).toBe("connecting");
  const s = r.socket();
  s.accept();
  expect(s.sent).toEqual([
    { t: "hello", hello: { session: "s-1", instance: "i-1", viewer: { compact: true } } },
  ]);
  s.serve({ t: "state", state: stateAt(1) });
  expect(r.session.link.phase).toBe("open");
  expect(r.session.state?.character.version).toBe(1);
});

test("each state replaces the last whole, and sets the clock offset", async () => {
  const r = rig();
  r.session.start();
  await settle();
  const s = r.greet(1, {
    pouches: [{ id: "p-1", family: "lock-pins", name: "Pin lock", goods: [] }],
  });
  expect(r.session.state?.pouches).toHaveLength(1);
  expect(r.session.offset).toBe(5_000_000 - r.clock.now);
  expect(r.session.serverNow()).toBe(5_000_000);
  r.clock.advance(300);
  s.serve({ t: "state", state: { ...stateAt(2), now: 5_000_900 } });
  expect(r.session.state?.pouches).toBeUndefined();
  expect(r.session.state?.character.version).toBe(2);
  expect(r.session.serverNow()).toBe(5_000_900);
});

test("a state that arrives late does not set the server's clock back", async () => {
  const r = rig();
  r.session.start();
  await settle();
  const s = r.greet(1);
  r.clock.advance(1000);
  // Stamped 400 ms after the first, it took 600 ms to arrive.
  s.serve({ t: "state", state: { ...stateAt(2), now: 5_000_400 } });
  expect(r.session.state?.character.version).toBe(2);
  expect(r.session.serverNow()).toBe(5_001_000);
  // A new connection measures afresh.
  s.drop();
  r.clock.advance(500);
  await settle();
  r.greet(3, { now: 5_000_700 });
  expect(r.session.serverNow()).toBe(5_000_700);
});

test("a dropped socket is dialled again, waiting from half a second up to fifteen", async () => {
  const r = rig();
  r.session.start();
  await settle();
  r.greet();
  const waits: number[] = [];
  for (let i = 0; i < 7; i++) {
    r.socket().drop();
    const link = r.session.link;
    expect(link.phase).toBe("retrying");
    if (link.phase === "retrying") waits.push(link.inMs);
    const before = r.sockets.length;
    r.clock.advance(waits.at(-1)! - 1);
    await settle();
    expect(r.sockets.length).toBe(before);
    r.clock.advance(1);
    await settle();
    expect(r.sockets.length).toBe(before + 1);
  }
  expect(waits).toEqual([500, 1000, 2000, 4000, 8000, 15000, 15000]);
  // A state makes the next wait short again, and the token was kept all along.
  r.greet();
  r.socket().drop();
  expect(r.session.link).toEqual({ phase: "retrying", inMs: 500 });
  expect(r.tokens).toHaveLength(1);
  expect(r.notes.filter((n) => n === "socket-close")).toHaveLength(8);
});

test("an intent names the newest row version and gets its reply", async () => {
  const r = rig();
  r.session.start();
  await settle();
  const s = r.greet(4);
  const done = r.session.intent("press", { option: "strike" });
  expect(s.of("intent")).toEqual([
    {
      t: "intent",
      seq: 1,
      intent: { id: "intent-1", version: 4, kind: "press", option: "strike" },
    },
  ]);
  r.reply({ id: "intent-1" });
  expect(await done).toMatchObject({ id: "intent-1", ok: true });
});

test("intents go one at a time, each after the state the last one left", async () => {
  const r = rig();
  r.session.start();
  await settle();
  const s = r.greet(4);
  void r.session.intent("machine-arm", { machine: { source: "beat" } });
  void r.session.intent("machine-solve", { machine: { log: { moves: [] } } });
  expect(s.of("intent")).toHaveLength(1);
  r.reply({ id: "intent-1" });
  // The arm moved the row; the solve waits for the state that says so.
  expect(s.of("intent")).toHaveLength(1);
  s.serve({ t: "state", state: stateAt(5) });
  expect(s.of("intent")).toHaveLength(2);
  expect(s.of("intent")[1]!.intent).toMatchObject({
    id: "intent-2",
    version: 5,
    kind: "machine-solve",
  });
});

test("a listener hears the state an intent left before the next intent goes", async () => {
  const r = rig();
  r.session.start();
  await settle();
  const s = r.greet(4);
  void r.session.intent("machine-arm", { machine: { source: "beat" } });
  const log = { moves: [{ at: 900, a: 1 }], end: 900 };
  void r.session.intent("machine-solve", { machine: { log } });
  r.session.subscribe(() => {
    if (r.session.state?.character.version === 5) log.end = 100;
  });
  r.reply({ id: "intent-1" });
  s.serve({ t: "state", state: stateAt(5) });
  expect(s.of("intent")[1]!.intent?.machine?.log?.end).toBe(100);
});

test("when no state follows an accepted intent, the next one still goes", async () => {
  const r = rig();
  r.session.start();
  await settle();
  const s = r.greet(4);
  void r.session.intent("press", { option: "a" });
  void r.session.intent("press", { option: "b" });
  r.reply({ id: "intent-1" });
  r.clock.advance(1500);
  expect(s.of("intent")).toHaveLength(2);
});

test("a refusal does not hold the next intent back", async () => {
  const r = rig();
  r.session.start();
  await settle();
  const s = r.greet(4);
  const first = r.session.intent("press", { option: "a" });
  void r.session.intent("press", { option: "b" });
  r.reply({ id: "intent-1", ok: false, refusal: { code: "no-encounter", message: "no" } });
  expect((await first).refusal?.code).toBe("no-encounter");
  expect(s.of("intent")).toHaveLength(2);
});

test("an unanswered intent is sent again after a reconnect, under the same id", async () => {
  const r = rig();
  r.session.start();
  await settle();
  const first = r.greet(4);
  const done = r.session.intent("machine-solve", { machine: { log: { moves: [] } } });
  expect(first.of("intent")).toHaveLength(1);
  first.drop();
  r.clock.advance(500);
  await settle();
  const second = r.socket();
  expect(second).not.toBe(first);
  second.accept();
  expect(second.of("intent")).toHaveLength(0);
  second.serve({ t: "state", state: stateAt(4) });
  expect(second.of("intent")).toEqual([first.of("intent")[0]]);
  // The world had applied it the first time: the stored reply comes back.
  second.serve({ t: "reply", reply: { id: "intent-1", ok: true, duplicate: true } });
  expect(await done).toMatchObject({ ok: true, duplicate: true });
});

test("an intent made while the line is down goes out once it is back", async () => {
  const r = rig();
  r.session.start();
  await settle();
  r.greet(4).drop();
  void r.session.intent("press", { option: "a" });
  r.clock.advance(500);
  await settle();
  const s = r.greet(6);
  expect(s.of("intent")[0]!.intent).toMatchObject({ id: "intent-1", version: 6 });
});

test("a stale refusal is retried with the row's version for a solve, never a choice", async () => {
  const r = rig();
  r.session.start();
  await settle();
  const s = r.greet(4);
  const kept = r.session.intent("machine-solve", { machine: { log: { moves: [] } } });
  for (const [n, version] of [9, 10, 11].entries()) {
    r.reply({
      id: `intent-${n + 1}`,
      ok: false,
      refusal: { code: "stale", message: "moved", version },
    });
    expect(s.of("intent")[n + 1]!.intent).toMatchObject({
      id: `intent-${n + 2}`,
      version,
      kind: "machine-solve",
    });
  }
  r.reply({ id: "intent-4", ok: false, refusal: { code: "stale", message: "moved", version: 12 } });
  expect((await kept).refusal?.code).toBe("stale");

  for (const kind of ["press", "machine-arm", "bench-lesson"]) {
    const plain = r.session.intent(kind, { option: "a" });
    const id = `intent-${s.of("intent").length}`;
    r.reply({ id, ok: false, refusal: { code: "stale", message: "moved", version: 13 } });
    expect((await plain).refusal?.code).toBe("stale");
  }
});

test("an expired session signs in again without being asked", async () => {
  const r = rig();
  r.session.start();
  await settle();
  const s = r.greet();
  r.answer = { session: "s-2", expires: 0, discordId: "d-1", characterId: "c-1" };
  s.serve({ t: "bye", bye: "expired" });
  s.drop();
  r.clock.advance(500);
  await settle();
  expect(r.tokens).toHaveLength(2);
  r.socket().accept();
  expect(r.socket().sent[0]!.hello?.session).toBe("s-2");
});

test("a player with no character is told to start in chat, and no socket opens", async () => {
  const r = rig();
  r.answer = { session: "s-1", expires: 0, discordId: "d-1" };
  r.session.start();
  await settle();
  expect(r.sockets).toHaveLength(0);
  expect(r.session.link).toMatchObject({ phase: "stopped", reason: "no-character" });
  // Having made one, trying again connects.
  r.answer = { session: "s-1", expires: 0, discordId: "d-1", characterId: "c-1" };
  r.session.start();
  await settle();
  expect(r.sockets).toHaveLength(1);
});

test("a socket replaced from another window stays closed until asked", async () => {
  const r = rig();
  r.session.start();
  await settle();
  const s = r.greet();
  s.serve({ t: "bye", bye: "replaced" });
  s.drop();
  r.clock.advance(60_000);
  await settle();
  expect(r.sockets).toHaveLength(1);
  expect(r.session.link).toMatchObject({ phase: "stopped", reason: "replaced" });
});

test("a goodbye that only arrives as the close reason is still heard", async () => {
  const r = rig();
  r.session.start();
  await settle();
  r.greet().drop(4001, "replaced");
  expect(r.session.link).toMatchObject({ phase: "stopped", reason: "replaced" });

  const other = rig();
  other.session.start();
  await settle();
  other.greet().drop(4001, "expired");
  other.clock.advance(500);
  await settle();
  expect(other.tokens).toHaveLength(2);

  // A process that went away says nothing: the next one answers expired.
  const gone = rig();
  gone.session.start();
  await settle();
  gone.greet().drop(1001, "");
  gone.clock.advance(500);
  await settle();
  expect(gone.tokens).toHaveLength(1);
  gone.socket().accept();
  gone.socket().serve({ t: "bye", bye: "expired" });
  gone.clock.advance(1000);
  await settle();
  expect(gone.tokens).toHaveLength(2);
});

test("a refused sign-in stops; a world that is not answering is tried again", async () => {
  const r = rig();
  r.answer = new SignInError("Discord would not sign you in.");
  r.session.start();
  await settle();
  expect(r.session.link).toMatchObject({ phase: "stopped", reason: "sign-in" });

  const again = rig();
  again.answer = new Error("503");
  again.session.start();
  await settle();
  expect(again.session.link).toEqual({ phase: "retrying", inMs: 500 });
  again.answer = { session: "s-1", expires: 0, discordId: "d-1", characterId: "c-1" };
  again.clock.advance(500);
  await settle();
  expect(again.sockets).toHaveLength(1);
});

test("a line gone quiet is dropped and dialled again", async () => {
  const r = rig();
  r.session.start();
  await settle();
  const s = r.greet();
  r.clock.advance(20_000);
  expect(s.of("ping")).toHaveLength(1);
  s.serve({ t: "pong" });
  r.clock.advance(40_000);
  expect(s.closed).toBe(false);
  r.clock.advance(40_000);
  expect(s.closed).toBe(true);
  await settle();
  expect(r.sockets).toHaveLength(2);
});

test("look tells the gateway what is open, and a reconnect says it again", async () => {
  const r = rig();
  r.session.start();
  await settle();
  const s = r.greet();
  r.session.look({ compact: true, family: "rewire", level: 3 });
  expect(s.of("look")).toEqual([
    { t: "look", look: { compact: true, family: "rewire", level: 3 } },
  ]);
  s.drop();
  r.clock.advance(500);
  await settle();
  r.socket().accept();
  expect(r.socket().sent[0]!.hello?.viewer).toEqual({ compact: true, family: "rewire", level: 3 });
});

test("a hint passed by another seat reaches its listeners", async () => {
  const r = rig();
  r.session.start();
  await settle();
  const s = r.greet();
  const got: unknown[] = [];
  r.session.onHint((m) => got.push(m));
  s.serve({ t: "hint", hint: { at: 0, a: 1, b: 2 } });
  r.session.passHint({ at: 0, a: 3 });
  expect(got).toEqual([{ at: 0, a: 1, b: 2 }]);
  expect(s.of("pass-hint")).toEqual([{ t: "pass-hint", hint: { at: 0, a: 3 } }]);
});

// A party machine armed at a seat: the state that says so.
function partyArmed(version: number, armedAt = 4_990_000, seat = 1) {
  return stateAt(version, {
    context: { kind: "party", id: "pt-1" },
    machine: {
      source: "party",
      family: "lock-dial",
      name: "Dial lock",
      layout: {
        family: "lock-dial",
        size: 2,
        decoys: 0,
        start: 0,
        goal: 0,
        party: "two-hand-lock",
        seats: 2,
      },
      preview: true,
      armed: true,
      armedAt,
      deadline: armedAt + 40_000,
      party: "two-hand-lock",
      seat,
      practice: { level: 0, uses: 0, need: 20 },
    },
  });
}

test("a party machine's moves stream one by one, the seat left to the gateway", async () => {
  const r = rig();
  r.session.start();
  await settle();
  const s = r.greet(1, partyArmed(1));
  expect(r.session.move({ at: 120, a: 1, b: 3 })).toBe(true);
  expect(r.session.move({ at: 380, a: 0, seat: 4 })).toBe(true);
  expect(s.of("move").map((m) => m.move)).toEqual([
    { at: 120, a: 1, b: 3 },
    { at: 380, a: 0 },
  ]);
  // This screen's copy of the merged log holds them with its own seat.
  expect(r.session.partyLog()).toEqual([
    { at: 120, a: 1, b: 3, seat: 1 },
    { at: 380, a: 0, seat: 1 },
  ]);
  expect(s.of("intent")).toEqual([]);
});

test("no move goes out without an armed party machine", async () => {
  const r = rig();
  r.session.start();
  await settle();
  const s = r.greet(1);
  expect(r.session.move({ at: 0, a: 1 })).toBe(false);
  expect(s.of("move")).toEqual([]);
});

test("moves relayed from other seats are heard, and the gateway's log replaces this screen's", async () => {
  const r = rig();
  r.session.start();
  await settle();
  const s = r.greet(1, partyArmed(1));
  const heard: unknown[] = [];
  r.session.onMoves((ev) => heard.push(ev));
  r.session.move({ at: 100, a: 0 });
  s.serve({ t: "move", move: { at: 140, a: 1 } });
  expect(heard).toEqual([{ kind: "move", move: { at: 140, a: 1 } }]);
  expect(r.session.partyLog()).toEqual([
    { at: 100, a: 0, seat: 1 },
    { at: 140, a: 1 },
  ]);
  // A return: the state again, then the merged log as the gateway kept it.
  s.drop();
  r.clock.advance(500);
  await settle();
  const again = r.greet(2, partyArmed(2));
  again.serve({
    t: "moves",
    moves: [
      { at: 90, a: 0, seat: 1 },
      { at: 140, a: 1 },
    ],
  });
  expect(heard.at(-1)).toEqual({
    kind: "moves",
    moves: [
      { at: 90, a: 0, seat: 1 },
      { at: 140, a: 1 },
    ],
  });
  expect(r.session.partyLog()).toHaveLength(2);
});

test("a move the gateway turned away leaves this screen's log, and another machine starts afresh", async () => {
  const r = rig();
  r.session.start();
  await settle();
  const s = r.greet(1, partyArmed(1));
  const heard: unknown[] = [];
  r.session.onMoves((ev) => heard.push(ev));
  r.session.move({ at: 100, a: 0 });
  r.session.move({ at: 120, a: 1 });
  const seq = s.of("move")[1]!.seq;
  s.serve({
    t: "reply",
    seq,
    reply: { id: "", ok: false, refusal: { code: "busy", message: "too many" } },
  });
  expect(r.session.partyLog()).toEqual([{ at: 100, a: 0, seat: 1 }]);
  expect(heard).toEqual([{ kind: "moves", moves: [{ at: 100, a: 0, seat: 1 }] }]);
  s.serve({ t: "state", state: partyArmed(2, 4_995_000) });
  expect(r.session.partyLog()).toEqual([]);
  s.serve({ t: "state", state: stateAt(3) });
  s.serve({ t: "move", move: { at: 10, a: 0 } });
  expect(r.session.partyLog()).toEqual([]);
});

test("a party intent carries its hunt and its deck", async () => {
  const r = rig();
  r.session.start();
  await settle();
  const s = r.greet(4);
  void r.session.intent("hunt-press", { target: "hn-2", option: "strike" });
  expect(s.of("intent")[0]!.intent).toMatchObject({
    kind: "hunt-press",
    version: 4,
    target: "hn-2",
    option: "strike",
  });
  r.reply({ id: s.of("intent")[0]!.intent!.id });
  await settle();
  r.clock.advance(1500);
  void r.session.intent("deck-swap", { item: "it-12" });
  expect(s.of("intent")[1]!.intent).toMatchObject({ kind: "deck-swap", item: "it-12" });
});
