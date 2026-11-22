import type { PartyRig } from "virtual:party-rigs";
import sheet from "virtual:puzzle-sheet";
import type { GoldenRig } from "virtual:rigs";

import {
  ActBenchLesson,
  ActBenchSolve,
  ActDeckSwap,
  ActDungeonLeave,
  ActDungeonPush,
  ActHuntPress,
  ActMachineArm,
  ActMachineSolve,
  ActPartyPick,
  ActPress,
  CodeBadArgs,
  CodeChose,
  CodeForbidden,
  CodeLockedDown,
  CodeMachineArmed,
  CodeNeedsActivity,
  CodeNoEncounter,
  CodeNoFork,
  CodeNoHunt,
  CodeNoLesson,
  CodeNoMachine,
  CodeNoSlot,
  CodeNotHere,
  CodeNoWay,
  CodePartyNotSeated,
  CodePicked,
  CodePressed,
  CodeStale,
  CodeSwapped,
  ContextHunt,
  ContextParty,
  FrameHello,
  FrameIntent,
  FrameLook,
  FrameMove,
  FrameMoves,
  FramePing,
  FramePong,
  FrameReply,
  FrameState,
  MachineBeat,
  MachineBench,
  MachineFork,
  MachinePattern,
  MachinePouch,
  type ActivityState,
  type ClientMessage,
  type Datum,
  type Fact,
  type Fight,
  type Intent,
  type IntentReply,
  type MachineDone,
  type MachineView,
  type PartyMember,
  type PartyView,
  type PracticeLine,
  type PuzzleMove,
  type PuzzleResult,
  type SeatView,
  type ServerMessage,
  type TokenReply,
  type Viewer,
} from "./api.ts";
import { streamed, type SocketLike } from "./session.ts";
import { GOING, type Family } from "./shell/kit.ts";
import { versionOf, type PartyVersion } from "./shell/party-registry.ts";
import { judge, play, playLimited } from "./shell/play.ts";
import { familyOf } from "./shell/registry.ts";
import type { PartyResult } from "./views/party.ts";
import { name } from "./words.ts";

/** What the mock runs on. */
export interface MockDeps {
  state: ActivityState;
  rigs: Record<string, GoldenRig[]>;
  /** The level a beat's machine is laid out at when the fixture draws none. */
  level?: number;
  now(): number;
  after(ms: number, f: () => void): () => void;
  /** A party fixture's party vectors, for its machines. */
  partyRigs?: Record<string, PartyRig[]>;
  /** How many of a party fixture's members sit at it. */
  seats?: number;
  /** Whether the members no screen has claimed play by script. */
  teammates?: boolean;
  /** The party versions the mock may lay out and judge; the registry's by default. */
  versions?: (id: string) => PartyVersion | undefined;
  /** The value chat's pattern-set armed a pattern point with, which no state shows; 0 by default. */
  patternValue?: number;
}

// The mock plays by the world's sheets; only the world service decides a
// real outcome. A lockdown's length and the haywire every machine does
// are imitations.
const LOCKDOWN_TICKS = 144;
const HAYWIRE = { id: "alarm", name: "alarm", magnitude: 40, unit: "gauge" };

/** What a practice level buys, as sim/puzzle's Gifts sums it. */
function gifts(practice: number) {
  const got = sheet.gifts.filter((g) => practice >= g.practice).map((g) => g.gives);
  return {
    preview: got.includes("preview"),
    guide: got.includes("guide-line"),
    mastery: got.includes("mastery"),
    hints: got.filter((g) => g === "hint").length,
  };
}

interface Armed {
  view: MachineView;
  at: number;
  cancel(): void;
}

/**
 * A stand-in for the gateway, for scene work with no world running: it
 * answers the socket's frames from a state fixture and the golden layouts.
 * Reached only with ?mock= in the address.
 */
export class MockGateway {
  private st: ActivityState;
  private viewer: Viewer = {};
  private armed: Armed | undefined;
  private runs = 0;
  private spent = "";
  private factId = 0;
  private socket: MockSocket | undefined;
  private readonly party: PartyMock | undefined;

  constructor(private readonly deps: MockDeps) {
    this.st = structuredClone(deps.state);
    if (deps.state.party || deps.state.hunt) {
      this.party = new PartyMock(deps);
      return;
    }
    const m = this.st.machine;
    if (m?.armed && m.armedAt) {
      // A fixture caught mid-countdown keeps the time it had left.
      const at = deps.now() - (this.st.now - m.armedAt);
      this.arm(m, at);
    }
  }

  token(): Promise<TokenReply> {
    if (this.party) return this.party.token();
    return Promise.resolve({
      session: "mock",
      expires: Math.trunc(this.deps.now() / 1000) + 7200,
      discordId: "mock",
      characterId: this.st.character.id,
    });
  }

  open(): SocketLike {
    if (this.party) return this.party.open();
    this.socket = new MockSocket((msg) => this.take(msg));
    const socket = this.socket;
    this.deps.after(0, () => socket.onopen?.());
    return socket;
  }

  /** Arms the machine in view as another window would, and says so. */
  armElsewhere(): void {
    if (this.party) return;
    const view = this.machine();
    if (!view || this.armed) return;
    this.arm(view, this.deps.now());
    this.st.character.version++;
    this.push();
  }

  private send(msg: ServerMessage): void {
    this.socket?.deliver(msg);
  }

  private take(msg: ClientMessage): void {
    switch (msg.t) {
      case FrameHello:
        this.viewer = msg.hello?.viewer ?? {};
        this.push();
        return;
      case FrameLook:
        this.viewer = msg.look ?? {};
        this.push();
        return;
      case FramePing:
        this.send({ t: FramePong });
        return;
      case FrameIntent:
        if (msg.intent) {
          this.send({ t: FrameReply, seq: msg.seq, reply: this.act(msg.intent) });
          this.push();
        }
        return;
    }
  }

  private push(): void {
    this.send({ t: FrameState, state: this.view() });
  }

  // The whole state as this viewer sees it now.
  private view(): ActivityState {
    const st = structuredClone(this.st);
    st.now = this.deps.now();
    st.character.armed = Boolean(this.armed);
    st.character.pouches = st.pouches?.length ?? 0;
    st.machine = this.machine();
    if (this.armed) st.bench = undefined;
    return st;
  }

  // The machine this viewer may work: the armed one, the beat's, the pouch
  // or the bench rig it has open.
  private machine(): MachineView | undefined {
    if (this.armed) return this.armed.view;
    if (this.st.fight?.machine)
      return this.st.machine ?? this.rig(MachineBeat, this.st.fight.machine, this.deps.level ?? 1);
    const pouch = this.st.pouches?.find((p) => p.id === this.viewer.pouch);
    if (pouch) {
      const m = this.rig(MachinePouch, pouch.family, 2);
      return m && { ...m, pouch: pouch.id, locked: pouch.locked };
    }
    const bench = this.st.bench?.families.find((f) => f.family === this.viewer.family);
    if (bench)
      return this.rig(
        MachineBench,
        bench.family,
        Math.min(Math.max(this.viewer.level ?? 1, 1), bench.maxLevel),
      );
    return undefined;
  }

  private practice(family: string): PracticeLine {
    const known = this.st.bench?.families.find((f) => f.family === family)?.practice;
    if (known) return known;
    const level = this.st.character.practice.find((s) => s.id === family)?.level ?? 0;
    return { level, uses: 0, need: need(level) };
  }

  // A machine laid out from the golden vectors: the case nearest the level,
  // and a different one each try.
  private rig(source: string, family: string, level: number): MachineView | undefined {
    const compact = Boolean(this.viewer.compact);
    const all = this.deps.rigs[family] ?? [];
    const sized = all.filter((r) => r.compact === compact);
    const near = [...(sized.length ? sized : all)].sort(
      (a, b) => Math.abs(a.level - level) - Math.abs(b.level - level),
    );
    // Never the machine that was just tried.
    const fresh = near.filter((r) => JSON.stringify(r.layout) !== this.spent);
    const cases = fresh.length ? fresh : near;
    const rig = cases[this.runs % Math.max(1, cases.length)];
    if (!rig) return undefined;
    const p = this.practice(family);
    const gift = gifts(p.level);
    const bench = source === MachineBench;
    const shown = bench || gift.preview;
    return {
      source,
      family,
      name: name("puzzles.families", family),
      layout: rig.layout,
      inner: gift.mastery ? rig.inner : undefined,
      compact: rig.compact,
      preview: gift.preview,
      level: shown ? rig.level : undefined,
      countdown: !bench && shown ? rig.countdown : undefined,
      why:
        !bench && shown
          ? [{ label: "family", value: Math.trunc(rig.countdown / 1000), unit: "s" }]
          : undefined,
      haywire: !bench && shown ? HAYWIRE : undefined,
      guide: gift.guide ? rig.hints[0] : undefined,
      hints: rig.hints.slice(0, gift.hints),
      armed: false,
      practice: { ...p, title: gift.mastery ? name("puzzles.titles", family) : undefined },
    };
  }

  private arm(view: MachineView, at: number): void {
    const countdown = view.countdown ?? this.countdown(view);
    const pass = view.hints?.[0] ?? view.guide;
    const cancel = this.deps.after(
      Math.max(0, at + countdown + sheet.grace + 250 - this.deps.now()),
      () => {
        this.resolve({ solved: false, clean: false, late: true, at: 0, haywire: HAYWIRE.id });
        this.push();
      },
    );
    this.armed = {
      at,
      cancel,
      view: {
        ...view,
        level: view.level ?? this.level(view),
        countdown,
        haywire: view.haywire ?? HAYWIRE,
        armed: true,
        armedAt: at,
        deadline: at + countdown,
        grace: sheet.grace,
        due: at + countdown + sheet.grace,
        ...(gifts(view.practice.level).mastery && pass ? { canPass: true, pass } : {}),
      },
    };
  }

  private golden(view: MachineView): GoldenRig | undefined {
    const layout = JSON.stringify(view.layout);
    return (this.deps.rigs[view.family] ?? []).find((r) => JSON.stringify(r.layout) === layout);
  }

  private countdown(view: MachineView): number {
    return this.golden(view)?.countdown ?? 40_000;
  }

  private level(view: MachineView): number {
    return this.golden(view)?.level ?? 1;
  }

  private act(intent: Intent): IntentReply {
    const refuse = (code: string, message: string): IntentReply => ({
      id: intent.id,
      ok: false,
      refusal: { code, message, version: this.st.character.version },
    });
    if (intent.version !== this.st.character.version)
      return refuse(CodeStale, "the character has moved on since this was shown");
    if (this.armed && intent.kind !== ActMachineSolve)
      return refuse(CodeMachineArmed, "a machine's countdown is running");
    const reply = this.apply(intent, refuse);
    if (reply.ok) this.st.character.version++;
    return reply;
  }

  private apply(
    intent: Intent,
    refuse: (code: string, message: string) => IntentReply,
  ): IntentReply {
    const ok = (more: Partial<IntentReply> = {}): IntentReply => ({
      id: intent.id,
      ok: true,
      ...more,
    });
    const m = intent.machine;
    switch (intent.kind) {
      case ActPress: {
        const option = this.st.fight?.options.find((o) => o.id === intent.option);
        if (!option) return refuse(CodeNoEncounter, "there is no such option on this beat");
        if (option.puzzle) return refuse(CodeNeedsActivity, "a machine is worked in the Activity");
        this.st.fight = undefined;
        this.st.machine = undefined;
        this.st.character.inFight = false;
        return ok({
          pressed: [{ option: option.id, band: option.band, success: true, why: option.why }],
        });
      }
      case ActMachineArm: {
        if (m?.source === MachinePattern)
          return refuse(CodeForbidden, "a pattern's point is set in chat, with its value");
        const view = this.machine();
        if (!view || view.source === MachineBench || !familyOf(view.family))
          return refuse(CodeNoMachine, "there is no machine here to arm");
        if (view.locked) return refuse(CodeLockedDown, "the machine has locked this character out");
        this.arm(view, this.deps.now());
        return ok({ facts: [this.fact("machine.armed", { family: view.family })] });
      }
      case ActMachineSolve: {
        const a = this.armed;
        const family = a && familyOf(a.view.family);
        if (!a || !family) return refuse(CodeNoMachine, "no machine is armed");
        const result = playLimited(
          family,
          a.view.layout,
          a.view.inner,
          m?.log ?? { moves: [] },
          {
            countdown: a.view.countdown ?? 0,
            elapsed: this.deps.now() - a.at,
            haywire: a.view.haywire?.id ?? HAYWIRE.id,
          },
          sheet,
        );
        return ok({ machine: result, facts: this.resolve(result) });
      }
      case ActBenchSolve: {
        const view = this.machine();
        const family = view && familyOf(view.family);
        if (!view || !family || view.source !== MachineBench)
          return refuse(CodeNotHere, "no bench rig is set up");
        const result = playLimited(
          family,
          view.layout,
          undefined,
          m?.log ?? { moves: [] },
          { countdown: 0, elapsed: -1, bench: true },
          sheet,
        );
        this.runs++;
        this.spent = JSON.stringify(view.layout);
        const bench = this.st.bench!;
        const gain = result.solved && bench.uses < bench.usesCap ? 1 : 0;
        bench.uses += gain;
        this.practise(view.family, gain);
        return ok({
          machine: result,
          facts: result.solved
            ? [this.fact("bench.solved", { family: view.family, uses: gain })]
            : [],
        });
      }
      case ActBenchLesson: {
        const bench = this.st.bench;
        const f = bench?.families.find((x) => x.family === m?.family);
        if (!bench || !f || f.lessons <= 0 || bench.taken >= bench.takenCap)
          return refuse(CodeNoLesson, "there is no lesson to take here");
        f.lessons--;
        bench.taken++;
        this.practise(f.family, 2);
        return ok({ facts: [this.fact("lesson.taken", { family: f.family })] });
      }
    }
    return refuse(CodeBadArgs, "the mock does not know that intent");
  }

  // What an armed machine's result does to the fixture's world.
  private resolve(result: PuzzleResult): Fact[] {
    const a = this.armed;
    if (!a) return [];
    a.cancel();
    this.armed = undefined;
    this.runs++;
    const { view } = a;
    this.spent = JSON.stringify(view.layout);
    this.st.last = {
      source: view.source,
      family: view.family,
      level: view.level ?? 1,
      tick: this.st.tick,
      result,
    };
    this.st.machine = undefined;
    this.practise(view.family, result.solved ? 4 : 1);
    if (!result.solved) {
      const pouch = this.st.pouches?.find((p) => p.id === view.pouch);
      if (pouch) pouch.locked = LOCKDOWN_TICKS;
      return [this.fact("puzzle.haywire", { family: view.family, late: result.late ? 1 : 0 })];
    }
    if (view.source === MachinePattern) {
      // A solve commits the value chat armed it with; what the board makes
      // of it is the world's to say.
      const p = this.st.pattern;
      if (!p) return [];
      const value = this.deps.patternValue ?? 0;
      p.held = value;
      return [this.fact("pattern.set", { board: p.board, point: p.point, value })];
    }
    if (view.source === MachinePouch) {
      const pouch = this.st.pouches?.find((p) => p.id === view.pouch);
      this.st.pouches = this.st.pouches?.filter((p) => p !== pouch);
      const goods = pouch?.goods.reduce((n, g) => n + g.units, 0) ?? 0;
      return [this.fact("pouch.opened", { family: view.family, goods })];
    }
    this.st.fight = undefined;
    this.st.character.inFight = false;
    return [this.fact("puzzle.solved", { family: view.family, ms: result.at })];
  }

  private practise(family: string, uses: number): void {
    const line = this.st.bench?.families.find((f) => f.family === family)?.practice;
    if (!line) return;
    line.uses += uses;
    while (line.need > 0 && line.uses >= line.need) {
      line.uses -= line.need;
      line.level++;
      line.need = need(line.level);
    }
  }

  private fact(kind: string, data: Record<string, string | number>): Fact {
    const out: Datum[] = Object.entries(data).map(([k, v]) =>
      typeof v === "string" ? { k, s: v } : { k, n: v },
    );
    return { id: ++this.factId, tick: this.st.tick, kind, subjects: [], data: out, weight: 5 };
  }
}

// Game.PracticeNeed, from the same cells.
function need(level: number): number {
  return level >= sheet.practiceMax ? 0 : sheet.practiceUses * (level + 1);
}

class MockSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev?: { code?: number; reason?: string }) => void) | null = null;

  constructor(private readonly take: (msg: ClientMessage) => void) {}

  send(data: string): void {
    const msg = JSON.parse(data) as ClientMessage;
    queueMicrotask(() => this.take(msg));
  }

  deliver(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  close(): void {}
}

// The party mock imitates a pick window, a hunt's tick, a press's health
// and the moments its scripted teammates act at; none of them is a rule.
const PICK_WINDOW = 120_000;
const TEAMMATE_MS = [1800, 3100, 4400];
const PRESS_EVERY = 3000;
const PRESS_HEALTH = 30;
const TEAM_LEAD = 1200;

// structural: the cautious option a window gives to whoever has not picked.
const CAUTIOUS = "hold";

interface Member {
  id: string;
  name: string;
  version: number;
  /** A screen signed in as it. */
  claimed: boolean;
  socket?: MockSocket;
  pick?: string;
  choice?: { push: boolean; way?: string };
  swapped?: number;
  removed: number;
  pressedAt: number;
  moved: boolean;
}

interface PartyArmed {
  version: PartyVersion;
  rig: PartyRig;
  source: string;
  at: number;
  moves: PuzzleMove[];
  cancel: (() => void)[];
}

// play() runs any model; a version's scene is not needed to judge it.
function judged(v: PartyVersion): Family {
  return {
    id: v.id,
    start: (layout) => v.start(layout),
    mount: () => {
      throw new Error(`the mock judges ${v.id}, it does not draw it`);
    },
  };
}

/**
 * The mock for a party or a hunt: every member of the fixture's party, or
 * every hunter of its hunt, is a seat a screen may claim, one sign-in
 * each. A claimed seat is played by its screen; the rest play by script on
 * deps.after when teammates is set. Each seat is sent its own state: its
 * own pick and its own dealt part only. A party machine's moves are kept
 * as one merged log, relayed to every other seat and judged here, as the
 * gateway does.
 */
class PartyMock {
  private st: ActivityState;
  private readonly members: Member[];
  private readonly window: number;
  private opened = 0;
  private forkOpened = 0;
  private closeBeat: (() => void) | undefined;
  private closeFork: (() => void) | undefined;
  private armed: PartyArmed | undefined;
  private done: MachineDone | undefined;
  private result: PartyResult | undefined;
  private scripted = new Set<string>();
  private factId = 0;

  constructor(private readonly deps: MockDeps) {
    this.st = structuredClone(deps.state);
    const now = deps.now();
    const at = (ms: number | undefined) => (ms ? now - (this.st.now - ms) : 0);
    const named = this.st.party
      ? [...this.st.party.members].sort((a, b) => Number(Boolean(b.you)) - Number(Boolean(a.you)))
      : [{ name: "You", you: true }, ...(this.st.hunt?.pressers ?? []).filter((p) => !p.you)];
    const seats = Math.min(Math.max(deps.seats ?? named.length, 1), named.length);
    const removed = new Map((this.st.hunt?.pressers ?? []).map((p) => [p.name, p.removed]));
    const youName = this.st.hunt?.pressers.find((p) => p.you)?.name;
    this.members = named.slice(0, seats).map((m, i) => ({
      id: i === 0 ? this.st.character.id : `c-mock-${i + 1}`,
      name: i === 0 && youName && !this.st.party ? youName : m.name,
      version: this.st.character.version,
      claimed: false,
      removed: removed.get(i === 0 && youName ? youName : m.name) ?? 0,
      pressedAt: 0,
      moved: false,
    }));
    if (this.st.hunt) this.members[0]!.removed = this.st.hunt.mine;
    // A fixture's open window keeps the time it had left, and the picks
    // and choices already made by the others.
    const beat = this.st.party?.beat;
    this.window = beat?.due && beat.opened ? beat.due - beat.opened : PICK_WINDOW;
    const fixtureMembers = this.st.party?.members ?? [];
    for (const m of this.members.slice(1)) {
      const was = fixtureMembers.find((x) => x.name === m.name);
      if (beat && was?.picked) m.pick = beat.cautious;
      const chose = this.st.floor?.choices?.find((c) => c.name === m.name);
      if (chose) m.choice = { push: chose.push, way: chose.way };
    }
    if (beat?.opened) this.openBeat(at(beat.opened));
    if (this.st.floor?.opened) this.openFork(at(this.st.floor.opened));
  }

  token(): Promise<TokenReply> {
    const i = this.members.findIndex((m) => !m.claimed);
    if (i < 0) return Promise.reject(new Error("every seat of the mock party is taken"));
    const m = this.members[i]!;
    m.claimed = true;
    return Promise.resolve({
      session: `mock-${i}`,
      expires: Math.trunc(this.deps.now() / 1000) + 7200,
      discordId: `mock-${i}`,
      characterId: m.id,
    });
  }

  open(): SocketLike {
    const socket: MockSocket = new MockSocket((msg) => this.take(socket, msg));
    this.deps.after(0, () => socket.onopen?.());
    return socket;
  }

  private take(socket: MockSocket, msg: ClientMessage): void {
    if (msg.t === FrameHello) {
      const i = Number(msg.hello?.session.replace(/^mock-/, ""));
      const m = this.members[i];
      if (!m) return;
      m.socket = socket;
      this.pushAll();
      // A seat back at an armed machine gets the merged log after its state.
      if (this.armed) socket.deliver({ t: FrameMoves, moves: structuredClone(this.armed.moves) });
      this.script();
      return;
    }
    const i = this.members.findIndex((m) => m.socket === socket);
    const m = this.members[i];
    if (!m) return;
    switch (msg.t) {
      case FrameLook:
        this.push(i);
        return;
      case FramePing:
        socket.deliver({ t: FramePong });
        return;
      case FrameMove:
        if (msg.move) this.seatMove(i, msg.move, msg.seq);
        return;
      case FrameIntent:
        if (msg.intent) {
          socket.deliver({ t: FrameReply, seq: msg.seq, reply: this.act(i, msg.intent) });
          this.pushAll();
          this.script();
        }
        return;
    }
  }

  private push(i: number): void {
    this.members[i]?.socket?.deliver({ t: FrameState, state: this.view(i) });
  }

  private pushAll(): void {
    for (const [i, m] of this.members.entries()) if (m.socket) this.push(i);
  }

  // A seat is at the machine when its screen is open, or when the script plays it.
  private here(i: number): boolean {
    const m = this.members[i]!;
    return Boolean(m.socket) || (Boolean(this.deps.teammates) && !m.claimed);
  }

  private shared(): boolean {
    return Boolean(this.st.fight?.shared);
  }

  private seats(i: number): SeatView[] {
    return this.members.map((m, j) => ({
      seat: j,
      name: m.name,
      ...(j === i ? { you: true } : {}),
      ...(this.armed && m.moved ? { moved: true } : {}),
      here: this.here(j),
    }));
  }

  // The whole state as member i sees it: its own pick, choice and part only.
  private view(i: number): ActivityState {
    const me = this.members[i]!;
    const st = structuredClone(this.st);
    const now = this.deps.now();
    st.now = now;
    st.character.id = me.id;
    st.character.version = me.version;
    st.character.armed = Boolean(this.armed);
    st.last = this.done && structuredClone(this.done);
    const f = st.fight;
    const inFight = Boolean(f?.shared);
    if (st.party) {
      st.context = { kind: ContextParty, id: st.party.id };
      const members: PartyMember[] = this.members.map((m, j) => ({
        name: m.name,
        ...(j === i ? { you: true } : {}),
        here: true,
        ...(inFight && m.pick ? { picked: true } : {}),
        ...(!inFight && st.floor && m.choice ? { picked: true } : {}),
        ...(st.floor?.floor ? { floor: st.floor.floor } : {}),
        seat: inFight || st.floor?.ways ? j : -1,
      }));
      st.party.members = members;
      st.party.beat = undefined;
      if (f && inFight) {
        f.party = members;
        st.party.beat = {
          beat: f.beat + 1,
          beats: f.beats,
          kind: f.kind,
          picked: this.members.filter((m) => m.pick).length,
          present: this.members.length,
          cautious: CAUTIOUS,
          ...(this.opened ? { opened: this.opened, due: this.opened + this.window } : {}),
          ...(me.pick ? { mine: me.pick } : {}),
          ...(this.armed ? { waiting: true } : {}),
        };
        const decks = (f as Fight & { decks?: unknown[] }).decks;
        if (decks && (me.pick || me.swapped === f.beat))
          delete (f as Fight & { decks?: unknown[] }).decks;
      }
      if (this.result) (st.party as PartyView & { last?: PartyResult }).last = this.result;
    } else if (st.hunt) {
      st.context = { kind: ContextHunt, id: st.hunt.id };
    }
    if (st.floor?.ways) {
      st.floor.choices = this.members
        .filter((m) => m.choice)
        .map((m) => ({
          name: m.name,
          push: m.choice!.push,
          ...(m.choice!.way ? { way: m.choice!.way } : {}),
        }));
      for (const w of st.floor.ways)
        w.votes = this.members.filter((m) => m.choice?.push && m.choice.way === w.id).length;
      if (this.forkOpened) {
        st.floor.opened = this.forkOpened;
        st.floor.due = this.forkOpened + this.window;
      }
    }
    if (st.hunt) {
      const h = st.hunt;
      const total = this.members.reduce((n, m) => n + m.removed, 0);
      h.pressers = this.members
        .map((m, j) => ({
          name: m.name,
          removed: m.removed,
          ...(j === i ? { you: true } : {}),
          pressedAt: m.pressedAt,
        }))
        .filter((p) => p.removed > 0 || p.pressedAt > 0)
        .sort((a, b) => b.removed - a.removed)
        .map(({ pressedAt: _p, ...p }) => p);
      h.mine = me.removed;
      h.share = total ? Math.trunc((me.removed * 100) / total) : 0;
      h.canPress = this.canPress(i);
      if (!h.canPress) h.options = undefined;
    }
    st.machine = this.machineFor(i, st.machine);
    return st;
  }

  private canPress(i: number): boolean {
    const h = this.st.hunt;
    const m = this.members[i]!;
    return (
      Boolean(h && h.health > 0) && (!m.pressedAt || this.deps.now() - m.pressedAt >= PRESS_EVERY)
    );
  }

  // A party machine as seat i is shown it: at rest with who sits at it, or
  // armed with this seat's dealt part alone.
  private machineFor(i: number, rest: MachineView | undefined): MachineView | undefined {
    const a = this.armed;
    if (!a) return rest && { ...rest, seat: i, seats: this.seats(i) };
    const { rig } = a;
    return {
      source: a.source,
      family: rig.family,
      name: name("puzzles.families", rig.family),
      layout: structuredClone(rig.parts[i] ?? rig.layout),
      preview: true,
      level: rig.level,
      countdown: rig.countdown,
      why: [{ label: "family", value: Math.trunc(rig.countdown / 1000), unit: "s" }],
      haywire: HAYWIRE,
      armed: true,
      armedAt: a.at,
      deadline: a.at + rig.countdown,
      grace: sheet.grace,
      due: a.at + rig.countdown + sheet.grace,
      practice: rest?.practice ?? { level: 0, uses: 0, need: need(0) },
      party: a.version.id,
      seat: i,
      seats: this.seats(i),
      movers: this.members.filter((m) => m.moved).length,
    };
  }

  private act(i: number, intent: Intent): IntentReply {
    const me = this.members[i]!;
    const refuse = (code: string, message: string): IntentReply => ({
      id: intent.id,
      ok: false,
      refusal: { code, message, version: me.version },
    });
    if (intent.version !== me.version)
      return refuse(CodeStale, "the character has moved on since this was shown");
    const reply = this.apply(i, intent, refuse);
    if (reply.ok) me.version++;
    return reply;
  }

  private apply(
    i: number,
    intent: Intent,
    refuse: (code: string, message: string) => IntentReply,
  ): IntentReply {
    const ok = (more: Partial<IntentReply> = {}): IntentReply => ({
      id: intent.id,
      ok: true,
      ...more,
    });
    const me = this.members[i]!;
    switch (intent.kind) {
      case ActPress:
      case ActPartyPick: {
        const f = this.st.fight;
        if (!f?.shared) return refuse(CodeNoEncounter, "there is no shared beat here");
        if (this.armed) return refuse(CodeMachineArmed, "the party's machine is armed");
        const option = f.options.find((o) => o.id === intent.option);
        if (!option) return refuse(CodeBadArgs, "that is not an option on this beat");
        if (option.puzzle) return refuse(CodeNeedsActivity, "a machine is worked in the Activity");
        if (me.pick) return refuse(CodePicked, "a pick is held until the beat resolves");
        this.pick(i, option.id);
        return ok();
      }
      case ActDeckSwap: {
        const f = this.st.fight;
        const decks = f ? ((f as Fight & { decks?: { id: string }[] }).decks ?? []) : [];
        if (!f || !decks.length) return refuse(CodeNoSlot, "this character carries one deck");
        if (me.pick) return refuse(CodePicked, "a deck is swapped before the pick");
        if (me.swapped === f.beat) return refuse(CodeSwapped, "a deck is swapped once a beat");
        if (!decks.some((d) => d.id === intent.item))
          return refuse(CodeBadArgs, "a deck swap names a deck carried in the pack");
        me.swapped = f.beat;
        return ok({ facts: [this.fact("item.equipped", { item: intent.item ?? "" })] });
      }
      case ActDungeonPush:
      case ActDungeonLeave: {
        const ways = this.st.floor?.ways;
        if (!ways?.length || this.shared()) return refuse(CodeNoFork, "there is no fork here");
        if (me.choice) return refuse(CodeChose, "a choice at the fork is made once");
        if (intent.kind === ActDungeonPush) {
          const way = ways.find((w) => w.id === intent.option);
          if (!way?.open) return refuse(CodeNoWay, "that way is not open");
          me.choice = { push: true, way: way.id };
        } else me.choice = { push: false };
        if (!this.forkOpened) this.openFork(this.deps.now());
        if (this.members.every((m) => m.choice)) this.resolveFork();
        return ok();
      }
      case ActHuntPress: {
        const h = this.st.hunt;
        if (!h || h.id !== intent.target)
          return refuse(CodeNoHunt, "there is no such hunt in reach");
        if (!this.canPress(i)) return refuse(CodePressed, "a hunt is pressed once a tick");
        const option = h.options?.find((o) => o.id === intent.option);
        if (!option) return refuse(CodeBadArgs, "that is not an option this press offers");
        const removed = this.press(i);
        return ok({
          pressed: [
            { option: option.id, band: option.band, success: removed > 0, why: option.why },
          ],
        });
      }
      case ActMachineArm:
        return this.arm(intent, refuse, ok);
      case ActMachineSolve:
        return refuse(CodeNoMachine, "a party machine's solve is the gateway's to write");
    }
    return refuse(CodeBadArgs, "the mock does not know that intent");
  }

  private pick(i: number, option: string): void {
    this.members[i]!.pick = option;
    if (!this.opened) this.openBeat(this.deps.now());
    if (this.members.every((m) => m.pick)) this.resolveBeat();
  }

  private openBeat(at: number): void {
    this.opened = at;
    this.closeBeat?.();
    this.closeBeat = this.deps.after(Math.max(0, at + this.window + 250 - this.deps.now()), () => {
      this.closeBeat = undefined;
      if (this.armed || !this.shared()) return;
      for (const m of this.members) m.pick ??= CAUTIOUS;
      this.resolveBeat();
      this.pushAll();
      this.script();
    });
  }

  private openFork(at: number): void {
    this.forkOpened = at;
    this.closeFork?.();
    this.closeFork = this.deps.after(Math.max(0, at + this.window + 250 - this.deps.now()), () => {
      this.closeFork = undefined;
      if (!this.st.floor?.ways) return;
      for (const m of this.members) m.choice ??= { push: false };
      this.resolveFork();
      this.pushAll();
    });
  }

  // Every pick goes at once: each member's press, shown to all of them.
  private resolveBeat(): void {
    const f = this.st.fight!;
    this.closeBeat?.();
    this.closeBeat = undefined;
    this.result = {
      beat: f.beat + 1,
      pressed: this.members.map((m) => {
        const o = f.options.find((x) => x.id === m.pick);
        return { name: m.name, option: m.pick ?? CAUTIOUS, band: o?.band ?? "even", success: true };
      }),
    };
    for (const m of this.members) m.pick = undefined;
    this.opened = 0;
    f.beat++;
    if (f.beat >= f.beats) this.endFight();
  }

  private endFight(): void {
    this.st.fight = undefined;
    this.st.machine = undefined;
    this.st.character.inFight = false;
  }

  // The most votes among those who push; a tie goes to the lowest way. If
  // nobody pushes, everyone leaves.
  private resolveFork(): void {
    const floor = this.st.floor!;
    this.closeFork?.();
    this.closeFork = undefined;
    const ways = floor.ways ?? [];
    const votes = ways.map(
      (w) => this.members.filter((m) => m.choice?.push && m.choice.way === w.id).length,
    );
    const best = Math.max(0, ...votes);
    for (const m of this.members) m.choice = undefined;
    this.forkOpened = 0;
    this.st.machine = undefined;
    if (best === 0) {
      this.st.floor = {
        ...floor,
        floor: 0,
        ways: undefined,
        choices: undefined,
        opened: undefined,
        due: undefined,
      };
      return;
    }
    const next = floor.floor + 1;
    this.st.floor = {
      ...floor,
      floor: next,
      deepest: Math.max(floor.deepest, next),
      ways: undefined,
      choices: undefined,
      opened: undefined,
      due: undefined,
    };
  }

  private press(i: number): number {
    const h = this.st.hunt!;
    const m = this.members[i]!;
    const removed = Math.min(PRESS_HEALTH, h.health);
    m.removed += removed;
    m.pressedAt = this.deps.now();
    h.health -= removed;
    // The next mock tick lets it press again.
    this.deps.after(PRESS_EVERY, () => {
      this.pushAll();
      this.script();
    });
    if (h.health <= 0) this.st.hunt = undefined;
    return removed;
  }

  private arm(
    intent: Intent,
    refuse: (code: string, message: string) => IntentReply,
    ok: (more?: Partial<IntentReply>) => IntentReply,
  ): IntentReply {
    const rest = this.st.machine;
    if (this.armed) return refuse(CodeMachineArmed, "the party's machine is armed");
    if (!rest || !streamed(rest) || intent.machine?.source !== rest.source)
      return refuse(CodeNoMachine, "there is no party machine here to arm");
    if (!this.members.every((_, j) => this.here(j)))
      return refuse(
        CodePartyNotSeated,
        "a party machine arms only when every member has a seat here",
      );
    const seats = this.members.length;
    const versions = this.deps.versions ?? versionOf;
    const drawn = Object.entries(this.deps.partyRigs ?? {})
      .flatMap(([id, rigs]) => rigs.map((rig) => ({ version: versions(id), rig })))
      .filter((x) => x.version && x.rig.family === rest.family && x.rig.seats === seats)
      .sort((a, b) => a.rig.shape - b.rig.shape || a.rig.level - b.rig.level)[0];
    if (!drawn?.version)
      return refuse(CodeNoMachine, "no party version of this machine is drawn here");
    const now = this.deps.now();
    const armed: PartyArmed = {
      version: drawn.version,
      rig: drawn.rig,
      source: rest.source,
      at: now,
      moves: [],
      cancel: [],
    };
    this.armed = armed;
    this.done = undefined;
    for (const m of this.members) m.moved = false;
    const { countdown } = drawn.rig;
    armed.cancel.push(
      this.deps.after(countdown + sheet.grace + 250, () => {
        if (this.armed !== armed) return;
        const result = playLimited(
          judged(armed.version),
          armed.rig.layout,
          undefined,
          { moves: armed.moves },
          { countdown, elapsed: this.deps.now() - armed.at, haywire: HAYWIRE.id },
          sheet,
        );
        this.resolveMachine(result);
      }),
    );
    // The scripted seats play their part of the rule's own solve.
    if (this.deps.teammates)
      for (const mv of drawn.rig.solve) {
        const seat = mv.seat ?? 0;
        if (this.members[seat]?.claimed) continue;
        armed.cancel.push(
          this.deps.after(TEAM_LEAD + mv.at, () => {
            if (this.armed === armed) this.seatMove(seat, { ...mv, at: TEAM_LEAD + mv.at });
          }),
        );
      }
    return ok({ facts: [this.fact("machine.armed", { family: rest.family })] });
  }

  // One move into the merged log, as the gateway keeps it: stamped with
  // its seat, never earlier than the last nor later than the time since
  // arming, relayed to every other seat, and judged.
  private seatMove(i: number, move: PuzzleMove, seq?: number): void {
    const a = this.armed;
    if (!a) {
      if (seq !== undefined)
        this.members[i]?.socket?.deliver({
          t: FrameReply,
          seq,
          reply: {
            id: "",
            ok: false,
            refusal: { code: CodeNoMachine, message: "no party machine is armed at this seat" },
          },
        });
      return;
    }
    const now = this.deps.now();
    const last = a.moves.at(-1)?.at ?? 0;
    const at = Math.max(last, Math.min(move.at, now - a.at));
    const kept: PuzzleMove = {
      at,
      a: move.a,
      ...(move.b ? { b: move.b } : {}),
      ...(move.c ? { c: move.c } : {}),
      ...(i ? { seat: i } : {}),
    };
    a.moves.push(kept);
    const first = !this.members[i]!.moved;
    this.members[i]!.moved = true;
    for (const [j, m] of this.members.entries())
      if (j !== i && m.socket) m.socket.deliver({ t: FrameMove, move: structuredClone(kept) });
    const out = play(
      judged(a.version),
      a.rig.layout,
      undefined,
      { moves: a.moves, end: now - a.at },
      a.rig.countdown + sheet.grace,
    );
    if (out.status === GOING) {
      if (first) this.pushAll();
      return;
    }
    const fail: PuzzleResult = { solved: false, clean: false, at: 0, haywire: HAYWIRE.id };
    this.resolveMachine(judge(out, fail, a.rig.countdown, now - a.at, sheet.grace, sheet.cleanPct));
  }

  // The one result every seat is shown at once.
  private resolveMachine(result: PuzzleResult): void {
    const a = this.armed;
    if (!a) return;
    for (const c of a.cancel) c();
    this.armed = undefined;
    this.done = {
      source: a.source,
      family: a.rig.family,
      level: a.rig.level,
      tick: this.st.tick,
      result,
    };
    if (result.solved && a.source === MachineFork) {
      const way = this.st.floor?.ways?.find((w) => w.machine && !w.open);
      if (way) way.open = true;
      this.st.machine = undefined;
    } else if (result.solved) {
      this.endFight();
    }
    this.pushAll();
    this.script();
  }

  // What the seats no screen has claimed do next, each once, a little
  // after the state asks it of them.
  private script(): void {
    if (!this.deps.teammates) return;
    for (const [i, m] of this.members.entries()) {
      if (m.claimed) continue;
      const wait = TEAMMATE_MS[(i - 1 + TEAMMATE_MS.length) % TEAMMATE_MS.length]!;
      const f = this.st.fight;
      if (f?.shared && !m.pick && !this.armed) {
        const option =
          f.options.find((o) => o.id === CAUTIOUS && !o.puzzle) ?? f.options.find((o) => !o.puzzle);
        if (option)
          this.later(`${i}:pick:${f.id}/${f.beat}`, wait, () => {
            if (this.st.fight === f && f.shared && !m.pick && !this.armed) this.pick(i, option.id);
          });
      }
      const ways = this.st.floor?.ways;
      if (ways?.length && !this.shared() && !m.choice) {
        const way = ways.find((w) => w.open);
        this.later(`${i}:fork:${this.st.floor!.floor}`, wait, () => {
          if (this.st.floor?.ways !== ways || m.choice) return;
          m.choice = way ? { push: true, way: way.id } : { push: false };
          if (!this.forkOpened) this.openFork(this.deps.now());
          if (this.members.every((x) => x.choice)) this.resolveFork();
        });
      }
      const h = this.st.hunt;
      if (h && this.canPress(i))
        this.later(`${i}:hunt:${m.pressedAt}`, wait, () => {
          if (this.st.hunt === h && this.canPress(i)) this.press(i);
        });
    }
  }

  private later(key: string, ms: number, f: () => void): void {
    if (this.scripted.has(key)) return;
    this.scripted.add(key);
    this.deps.after(ms, () => {
      f();
      this.pushAll();
      this.script();
    });
  }

  private fact(kind: string, data: Record<string, string | number>): Fact {
    const out: Datum[] = Object.entries(data).map(([k, v]) =>
      typeof v === "string" ? { k, s: v } : { k, n: v },
    );
    return { id: ++this.factId, tick: this.st.tick, kind, subjects: [], data: out, weight: 5 };
  }
}
