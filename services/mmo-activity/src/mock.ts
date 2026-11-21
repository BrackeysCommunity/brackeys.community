import sheet from "virtual:puzzle-sheet";
import type { GoldenRig } from "virtual:rigs";

import {
  ActBenchLesson,
  ActBenchSolve,
  ActMachineArm,
  ActMachineSolve,
  ActPress,
  CodeBadArgs,
  CodeLockedDown,
  CodeMachineArmed,
  CodeNeedsActivity,
  CodeNoEncounter,
  CodeNoLesson,
  CodeNoMachine,
  CodeNotHere,
  CodeStale,
  FrameHello,
  FrameIntent,
  FrameLook,
  FramePing,
  FramePong,
  FrameReply,
  FrameState,
  MachineBeat,
  MachineBench,
  MachinePouch,
  type ActivityState,
  type ClientMessage,
  type Datum,
  type Fact,
  type Intent,
  type IntentReply,
  type MachineView,
  type PracticeLine,
  type PuzzleResult,
  type ServerMessage,
  type TokenReply,
  type Viewer,
} from "./api.ts";
import type { SocketLike } from "./session.ts";
import { DONE } from "./shell/kit.ts";
import { judge, play } from "./shell/play.ts";
import { familyOf } from "./shell/registry.ts";
import { name } from "./words.ts";

/** What the mock runs on. */
export interface MockDeps {
  state: ActivityState;
  rigs: Record<string, GoldenRig[]>;
  /** The level a beat's machine is laid out at when the fixture draws none. */
  level?: number;
  now(): number;
  after(ms: number, f: () => void): () => void;
}

// The mock plays by the world's sheets; only the world service decides a
// real outcome. A lockdown's length is an imitation.
const LOCKDOWN_TICKS = 144;

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

  constructor(private readonly deps: MockDeps) {
    this.st = structuredClone(deps.state);
    const m = this.st.machine;
    if (m?.armed && m.armedAt) {
      // A fixture caught mid-countdown keeps the time it had left.
      const at = deps.now() - (this.st.now - m.armedAt);
      this.arm(m, at);
    }
  }

  token(): Promise<TokenReply> {
    return Promise.resolve({
      session: "mock",
      expires: Math.trunc(this.deps.now() / 1000) + 7200,
      discordId: "mock",
      characterId: this.st.character.id,
    });
  }

  open(): SocketLike {
    this.socket = new MockSocket((msg) => this.take(msg));
    const socket = this.socket;
    this.deps.after(0, () => socket.onopen?.());
    return socket;
  }

  /** Arms the machine in view as another window would, and says so. */
  armElsewhere(): void {
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
      haywire:
        !bench && shown ? { id: "alarm", name: "alarm", magnitude: 40, unit: "gauge" } : undefined,
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
        this.resolve({ solved: false, clean: false, late: true, at: 0, haywire: "alarm" });
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
        haywire: view.haywire ?? { id: "alarm", name: "alarm", magnitude: 40, unit: "gauge" },
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
        const countdown = a.view.countdown ?? 0;
        const elapsed = this.deps.now() - a.at;
        const limit = countdown + sheet.grace;
        const fail: PuzzleResult = {
          solved: false,
          clean: false,
          at: 0,
          haywire: a.view.haywire?.id ?? "alarm",
        };
        let result: PuzzleResult = { ...fail, late: true };
        if (elapsed <= limit) {
          const log = m?.log ?? { moves: [] };
          const out = play(
            family,
            a.view.layout,
            a.view.inner,
            log,
            Math.min(limit, elapsed + sheet.grace),
          );
          result = judge(out, fail, countdown, elapsed, sheet.grace, sheet.cleanPct);
        }
        return ok({ machine: result, facts: this.resolve(result) });
      }
      case ActBenchSolve: {
        const view = this.machine();
        const family = view && familyOf(view.family);
        if (!view || !family || view.source !== MachineBench)
          return refuse(CodeNotHere, "no bench rig is set up");
        const out = play(family, view.layout, undefined, m?.log ?? { moves: [] }, sheet.maxPlay);
        this.runs++;
        this.spent = JSON.stringify(view.layout);
        const bench = this.st.bench!;
        const solved = out.status === DONE;
        const gain = solved && bench.uses < bench.usesCap ? 1 : 0;
        bench.uses += gain;
        this.practise(view.family, gain);
        return ok({
          machine: { solved, clean: false, at: solved ? out.at : 0 },
          facts: solved ? [this.fact("bench.solved", { family: view.family, uses: gain })] : [],
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
