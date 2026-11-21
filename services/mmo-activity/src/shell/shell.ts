import {
  ActBenchSolve,
  ActMachineArm,
  ActMachineSolve,
  CodeNoMachine,
  MachineBench,
  type Fact,
  type IntentReply,
  type MachineView,
  type PuzzleLayout,
  type PuzzleLog,
  type PuzzleMove,
  type PuzzleResult,
  type Refusal,
} from "../api.ts";
import type { IntentBody } from "../session.ts";
import { refusalLine } from "../words.ts";
import {
  BROKE,
  DONE,
  GOING,
  type Family,
  type Model,
  type Scene,
  type SceneHost,
  type Status,
} from "./kit.ts";

export interface ShellDeps {
  family: Family;
  surface: HTMLElement;
  /** This device's clock, ms. */
  wall(): number;
  /** The server's clock as the session reads it, unix ms. */
  serverNow(): number;
  /** Whether the socket is open: a machine is not armed into a dead line. */
  online(): boolean;
  intent(kind: string, body: IntentBody, stale?: number): Promise<IntentReply>;
  /** Something the chrome draws has changed. */
  changed(): void;
}

// rest: studied, no timer. play: the clock is running. sending: the log
// is with the server. done: the server has answered.
export type Phase = "rest" | "play" | "sending" | "done";

/** What the server made of a log, or why it would not take one. */
export interface Ending {
  result?: PuzzleResult;
  refusal?: Refusal;
  facts: Fact[];
}

// How often a solve or an arm is sent again when the row moved under it.
const STALE_RETRIES = 3;

// How many moves of a log moved back may keep their own stamps.
const KEPT_STAMPS = 8;

/**
 * One machine on screen, from study to result. It owns the clock, the log
 * and the running model; the scene only draws and turns gestures into
 * moves. Nothing here decides an outcome: the model is a mirror for
 * smoothness, and the result shown is the server's reply.
 */
export class Shell {
  phase: Phase = "rest";
  /** 0 the machine, 1 a master's hidden panel. */
  panel: 0 | 1 = 0;
  /** A refusal or a notice to show over the study view. */
  note = "";
  ending: Ending | undefined;
  /** Leave a bench solve as a lesson. */
  teach = false;
  machine: MachineView;

  private model: Model;
  private scene: Scene | undefined;
  private moves: PuzzleMove[] = [];
  private base = 0; // the ms the panel on screen started at
  private t0 = 0; // this device's clock at the first touch
  private armedAt: number | undefined; // the server's, once it has answered
  private synced = false; // the clock follows the server's armedAt
  private last = 0; // the newest stamp or step, so time never runs back
  private stopped = 0; // the ms the play ended at
  private hinted = 0;
  private passed = false;
  private attempt = 0;
  private sent: PuzzleLog | undefined; // the log on its way

  constructor(
    private readonly deps: ShellDeps,
    machine: MachineView,
  ) {
    this.machine = machine;
    this.model = deps.family.start(machine.layout);
    if (machine.armed && machine.armedAt) {
      // Armed before this page knew it: the log is gone, so the model runs
      // from rest to the server's elapsed time with no inputs.
      this.phase = "play";
      this.armedAt = machine.armedAt;
      this.synced = true;
    }
    this.mount();
  }

  get bench(): boolean {
    return this.machine.source === MachineBench;
  }

  /** Whether the server has said this machine is armed. */
  get acked(): boolean {
    return this.armedAt !== undefined;
  }

  /** The newest state's view of this same machine. */
  update(machine: MachineView): void {
    this.machine = machine;
    const live = this.phase === "play" || this.phase === "sending";
    if (live && machine.armed && machine.armedAt && this.armedAt === undefined) {
      this.armedAt = machine.armedAt;
      // How far this clock ran ahead of the server's arming. Stamps a
      // little ahead are inside the grace; further and the log is moved
      // back onto the server's clock, or it would be replayed as late.
      const lead = machine.armedAt - (this.deps.serverNow() - (this.deps.wall() - this.t0));
      if (lead > (machine.grace ?? 0) / 2) {
        if (this.phase === "play") this.rebase(lead);
        else this.shift(lead);
      }
    }
    this.deps.changed();
  }

  /** The server ended the machine itself: the countdown ran out. */
  conclude(result: PuzzleResult): void {
    if (this.phase === "done" && this.ending?.result) return;
    this.freeze();
    this.phase = "done";
    this.ending = { result, facts: [] };
    this.deps.changed();
  }

  /** Ms left of the countdown, from the server's deadline. */
  left(): number | undefined {
    const deadline = this.machine.deadline;
    if (this.phase === "rest" || !this.machine.armed || !deadline) return undefined;
    return Math.max(0, deadline - this.deps.serverNow());
  }

  /** Ms since the first touch; 0 at rest. */
  now(): number {
    if (this.phase === "rest") return 0;
    if (this.phase !== "play") return this.stopped;
    const at =
      this.synced && this.armedAt !== undefined
        ? this.deps.serverNow() - this.armedAt
        : this.deps.wall() - this.t0;
    this.last = Math.max(this.last, Math.trunc(at));
    return this.last;
  }

  /** One animation frame: the model runs to now and the scene draws it. */
  tick(): void {
    if (this.phase === "play") {
      const at = this.now();
      const [st, when] = this.model.run(at - this.base);
      if (st !== GOING) this.settle(st, this.base + when);
      else if (this.left() === 0) this.finish(at);
    }
    this.scene?.frame(this.now() - (this.phase === "rest" ? 0 : this.base));
  }

  hintsLeft(): number {
    return this.panel === 0 ? (this.machine.hints?.length ?? 0) - this.hinted : 0;
  }

  /** Shows the next hint the practice allows. */
  hint(): void {
    const m = this.machine.hints?.[this.hinted];
    if (!m || this.panel !== 0) return;
    this.hinted++;
    this.scene?.hint(m);
    this.deps.changed();
  }

  /** A hint passed on by a master in the same context. */
  showHint(m: PuzzleMove): void {
    if (this.panel === 0) this.scene?.hint(m);
  }

  /** The move a master may pass to the others, once a machine. */
  passable(): PuzzleMove | undefined {
    if (this.passed || this.phase !== "play" || !this.machine.canPass) return undefined;
    return this.machine.hints?.[0] ?? this.machine.guide;
  }

  markPassed(): void {
    this.passed = true;
    this.deps.changed();
  }

  /** Whether the log can be sent as it stands: a hidden panel left, or a bench rig given up. */
  leavable(): boolean {
    return this.phase === "play" && (this.panel === 1 || this.bench);
  }

  leave(): void {
    if (this.leavable()) this.finish(this.now());
  }

  destroy(): void {
    this.attempt++;
    this.scene?.destroy();
    this.scene = undefined;
  }

  private host(layout: PuzzleLayout, outer: boolean): SceneHost {
    const model = () => this.model;
    return {
      surface: this.deps.surface,
      layout,
      compact: Boolean(this.machine.compact),
      guide: outer ? this.machine.guide : undefined,
      get model() {
        return model();
      },
      move: (a, b, c) => this.move(a, b, c),
      arm: () => {
        if (this.phase === "rest") this.begin();
      },
      now: () => (this.phase === "rest" ? 0 : this.now() - this.base),
    };
  }

  private mount(): void {
    this.scene?.destroy();
    const inner = this.panel === 1 ? this.machine.inner : undefined;
    this.scene = this.deps.family.mount(this.host(inner ?? this.machine.layout, !inner));
    this.scene.frame(this.phase === "rest" ? 0 : this.now() - this.base);
  }

  // The first touch: the clock starts here, before the server has answered.
  private begin(): boolean {
    if (this.machine.locked) {
      this.say("This machine has locked you out for now.");
      return false;
    }
    if (!this.bench && !this.deps.online()) {
      this.say("Reconnecting. The machine is still at rest.");
      return false;
    }
    this.note = "";
    this.t0 = this.deps.wall();
    this.last = 0;
    this.phase = "play";
    if (!this.bench) {
      const attempt = this.attempt;
      const m = this.machine;
      const body = { machine: { source: m.source, pouch: m.pouch, compact: m.compact } };
      void this.deps.intent(ActMachineArm, body, STALE_RETRIES).then((reply) => {
        if (attempt !== this.attempt || reply.ok) return;
        this.reset(reply.refusal ? refusalLine(reply.refusal) : "The machine would not arm.");
      });
    }
    this.deps.changed();
    return true;
  }

  private move(a: number, b = 0, c = 0): Status {
    if (this.phase === "rest" && !this.begin()) return GOING;
    if (this.phase !== "play") return GOING;
    const at = this.now();
    const st = this.feed({ at, a, ...(b ? { b } : {}), ...(c ? { c } : {}) });
    this.settle(st[0], st[1]);
    return st[0];
  }

  // feed plays one stamped move into the panel on screen, as the server's
  // replay will: the model runs to the stamp, then takes the move. A move
  // the clock overtook is not part of the log.
  private feed(m: PuzzleMove): [Status, number] {
    const rel = m.at - this.base;
    const [ran, when] = this.model.run(rel);
    if (ran !== GOING) return [ran, this.base + when];
    this.moves.push(m);
    return [this.model.apply({ ...m, at: rel }), m.at];
  }

  private settle(st: Status, at: number): void {
    if (st === GOING) return;
    if (st === DONE && this.panel === 0 && this.machine.inner && !this.bench) {
      this.panel = 1;
      this.base = at;
      this.model = this.deps.family.start(this.machine.inner);
      this.mount();
      this.deps.changed();
      return;
    }
    this.finish(at);
  }

  // Moves the log back by lead ms and plays it again from rest, so the
  // model on screen is the one the server will replay.
  private rebase(lead: number): void {
    const moves = this.moves;
    const stamps = this.movedBack(moves, lead);
    this.moves = [];
    this.panel = 0;
    this.base = 0;
    this.last = 0;
    this.synced = true;
    this.model = this.deps.family.start(this.machine.layout);
    let ended = false;
    for (const [i, m] of moves.entries()) {
      this.last = stamps[i]!;
      const [st, at] = this.feed({ ...m, at: stamps[i]! });
      if (st === GOING) continue;
      if (st === DONE && this.panel === 0 && this.machine.inner) {
        this.panel = 1;
        this.base = at;
        this.model = this.deps.family.start(this.machine.inner);
        continue;
      }
      this.mount();
      this.finish(at);
      ended = true;
      break;
    }
    if (!ended) this.mount();
  }

  // The play ended before the server said when it began: the log waiting
  // to go is moved back by lead ms where it stands.
  private shift(lead: number): void {
    const log = this.sent;
    if (!log) return;
    const stamps = this.movedBack(log.moves, lead);
    for (const [i, m] of log.moves.entries()) m.at = stamps[i]!;
    log.end = Math.max(stamps.at(-1) ?? 0, Math.trunc((log.end ?? 0) - lead));
    this.stopped = log.end;
  }

  // The stamps of a log moved back by lead ms, never out of order. A move
  // that breaks the machine only because it was moved (a swipe timed from
  // the first touch no longer fits the gap before it) keeps its own stamp.
  private movedBack(moves: PuzzleMove[], lead: number): number[] {
    const kept = new Set<number>();
    for (;;) {
      const stamps: number[] = [];
      let model = this.deps.family.start(this.machine.layout);
      let inner = false;
      let base = 0;
      let floor = 0;
      let live = true;
      let broke = -1;
      for (const [i, m] of moves.entries()) {
        floor = Math.max(floor, kept.has(i) ? m.at : Math.trunc(m.at - lead), 0);
        stamps.push(floor);
        if (!live) continue;
        let [st, when] = model.run(floor - base);
        const ran = st !== GOING;
        if (!ran) [st, when] = [model.apply({ ...m, at: floor - base }), floor - base];
        if (st === GOING) continue;
        if (st === DONE && !inner && this.machine.inner) {
          inner = true;
          base += when;
          model = this.deps.family.start(this.machine.inner);
          continue;
        }
        live = false;
        if (st === BROKE && !ran) broke = i;
      }
      if (broke < 0 || kept.has(broke) || kept.size >= KEPT_STAMPS) return stamps;
      kept.add(broke);
    }
  }

  private freeze(): void {
    if (this.phase === "play") this.stopped = this.now();
  }

  // The play is over on this side: the log goes to the server, which says
  // what it was.
  private finish(end: number): void {
    this.stopped = Math.max(end, this.moves.at(-1)?.at ?? 0);
    this.phase = "sending";
    const attempt = this.attempt;
    const log = { moves: this.moves, end: this.stopped };
    this.sent = log;
    const m = this.machine;
    const send = this.bench
      ? this.deps.intent(ActBenchSolve, {
          machine: {
            source: MachineBench,
            family: m.family,
            level: m.level,
            compact: m.compact,
            teach: this.teach,
            log,
          },
        })
      : this.deps.intent(ActMachineSolve, { machine: { log } }, STALE_RETRIES);
    void send.then((reply) => {
      if (attempt !== this.attempt) return;
      // The state may have told the ending first; the reply adds its facts,
      // and one that names no result leaves that ending standing.
      const told = this.phase === "done" ? this.ending : undefined;
      this.phase = "done";
      if (reply.machine || !told)
        this.ending = {
          result: reply.machine,
          // The server's own timer got there first; its result comes with the state.
          refusal: reply.refusal?.code === CodeNoMachine ? undefined : reply.refusal,
          facts: reply.facts ?? [],
        };
      this.deps.changed();
    });
    this.deps.changed();
  }

  // Back to rest, as if never touched: a refused arm.
  private reset(note: string): void {
    this.attempt++;
    this.phase = "rest";
    this.panel = 0;
    this.base = 0;
    this.last = 0;
    this.moves = [];
    this.armedAt = undefined;
    this.synced = false;
    this.model = this.deps.family.start(this.machine.layout);
    this.mount();
    this.say(note);
  }

  private say(note: string): void {
    this.note = note;
    this.deps.changed();
  }
}
