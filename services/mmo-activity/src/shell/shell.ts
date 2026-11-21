import {
  ActBenchSolve,
  ActMachineArm,
  ActMachineSolve,
  CodeBusy,
  CodeInternal,
  CodeNoMachine,
  CodeStale,
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
import { GOING, type Family, type Scene, type SceneHost, type Status } from "./kit.ts";
import { Run, movedBack } from "./play.ts";

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
  /** A timer; the returned function cancels it. */
  after(ms: number, f: () => void): () => void;
  /** One line of telemetry. */
  beacon(event: string, data: Record<string, string | number | boolean>): void;
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

// A solve turned away for a reason that is not the rules' leaves the
// machine armed, so the same log goes again after this wait: for as long
// as the server would still take it, or this many times when the page
// never learned when that is.
const RESEND_MS = 400;
const RESENDS_UNTIMED = 5;
const RESENDABLE: string[] = [CodeInternal, CodeBusy, CodeStale];

// How long a hint stays lit, unless its family asks for longer.
const HINT_MS = 3000;

// How often, at most, a play's missed touches are reported while it runs.
const DROPS_EVERY = 5000;

/** Touches counted since the last report, and how far they landed from their marks. */
interface Drops {
  n: number;
  landed: number;
  sumPx: number;
  worstPx: number;
  hitPx: number;
  pointer: string;
}

/**
 * One machine on screen, from study to result. It owns the clock, the log
 * and the running model; the scene only draws and turns gestures into
 * moves. Nothing here decides an outcome: the model is a mirror for
 * smoothness, and the result shown is the server's reply.
 */
export class Shell {
  phase: Phase = "rest";
  /** A refusal or a notice to show over the study view. */
  note = "";
  ending: Ending | undefined;
  /** Leave a bench solve as a lesson. */
  teach = false;
  machine: MachineView;

  private run: Run;
  private scene: Scene | undefined;
  private moves: PuzzleMove[] = [];
  private t0 = 0; // this device's clock at the first touch
  private armedAt: number | undefined; // the server's, once it has answered
  private synced = false; // the clock follows the server's armedAt
  private last = 0; // the newest stamp or step, so time never runs back
  private stopped = 0; // the ms the play ended at
  private hinted = 0;
  private lit: { move: PuzzleMove; until: number } | undefined; // the hint on show
  private passed = false;
  private attempt = 0;
  private sent: PuzzleLog | undefined; // the log on its way
  private resends = 0;
  private drops: Drops | undefined;
  private dropsAt = 0; // this device's clock at the last report of them

  constructor(
    private readonly deps: ShellDeps,
    machine: MachineView,
  ) {
    this.machine = machine;
    this.run = this.fresh();
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

  /** 0 the machine, 1 a master's hidden panel. */
  get panel(): 0 | 1 {
    return this.run.panel;
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
      const panel = this.run.panel;
      const [st, when] = this.run.run(at);
      this.settle(st, when, panel);
      if (this.phase === "play" && this.left() === 0) this.finish(at);
      else if (this.phase === "play" && this.bench && at >= (this.machine.maxPlay ?? Infinity)) {
        // The server replays a bench rig no further than this.
        this.note = "This rig has been on the bench as long as one may. The bench sets up another.";
        this.finish(at);
      }
      if (this.drops && this.deps.wall() - this.dropsAt >= DROPS_EVERY) this.reportDrops();
    }
    this.scene?.frame(this.now() - (this.phase === "rest" ? 0 : this.run.base));
  }

  hintsLeft(): number {
    return this.panel === 0 ? (this.machine.hints?.length ?? 0) - this.hinted : 0;
  }

  /** Shows the next hint the practice allows. */
  hint(): void {
    const m = this.machine.hints?.[this.hinted];
    if (!m || this.panel !== 0) return;
    this.hinted++;
    this.light(m);
    this.deps.changed();
  }

  /** A hint passed on by a master in the same context. */
  showHint(m: PuzzleMove): void {
    if (this.panel === 0) this.light(m);
  }

  private light(move: PuzzleMove): void {
    this.lit = { move, until: this.deps.wall() + (this.deps.family.hintMs ?? HINT_MS) };
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
    this.reportDrops();
    this.scene?.destroy();
    this.scene = undefined;
  }

  // A run from rest. The bench never opens a hidden panel: its replay has no master.
  private fresh(): Run {
    const m = this.machine;
    return new Run(this.deps.family, m.layout, this.bench ? undefined : m.inner);
  }

  private host(layout: PuzzleLayout, outer: boolean): SceneHost {
    const model = () => this.run.model;
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
      now: () => (this.phase === "rest" ? 0 : this.now() - this.run.base),
      hinted: () => {
        if (this.lit && this.deps.wall() > this.lit.until) this.lit = undefined;
        return outer ? this.lit?.move : undefined;
      },
      dropped: (missPx, hitPx, landed, ev) => {
        const d = (this.drops ??= {
          n: 0,
          landed: 0,
          sumPx: 0,
          worstPx: 0,
          hitPx: 0,
          pointer: "",
        });
        d.n++;
        if (landed) d.landed++;
        d.sumPx += missPx;
        d.worstPx = Math.max(d.worstPx, missPx);
        d.hitPx = hitPx;
        d.pointer = ev.pointerType;
      },
    };
  }

  // One summary of the touches since the last, so a tap is never a request.
  private reportDrops(): void {
    const d = this.drops;
    this.drops = undefined;
    this.dropsAt = this.deps.wall();
    if (!d) return;
    this.deps.beacon("drop", {
      family: this.machine.family,
      touches: d.n,
      landed: d.landed,
      missPx: Math.round(d.sumPx / d.n),
      worstPx: Math.round(d.worstPx),
      hitPx: Math.round(d.hitPx),
      pointer: d.pointer,
    });
  }

  private mount(): void {
    this.scene?.destroy();
    const inner = this.panel === 1 ? this.machine.inner : undefined;
    this.scene = this.deps.family.mount(this.host(inner ?? this.machine.layout, !inner));
    this.scene.frame(this.phase === "rest" ? 0 : this.now() - this.run.base);
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
    this.dropsAt = this.t0;
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
    const panel = this.run.panel;
    const [st, at] = this.feed({ at: this.now(), a, ...(b ? { b } : {}), ...(c ? { c } : {}) });
    this.settle(st, at, panel);
    return st;
  }

  // feed plays one stamped move into the run, as the server's replay will.
  // A move the clock overtook is not part of the log.
  private feed(m: PuzzleMove): [Status, number] {
    const [st, at, took] = this.run.feed(m);
    if (took) this.moves.push(m);
    return [st, at];
  }

  // After the run moved: the hidden panel is mounted when it opened, and
  // the play is over when the run is.
  private settle(st: Status, at: number, panel: 0 | 1): void {
    if (this.run.panel !== panel) {
      this.mount();
      this.deps.changed();
    }
    if (st !== GOING) this.finish(at);
  }

  // Moves the log back by lead ms and plays it again from rest, so the
  // model on screen is the one the server will replay.
  private rebase(lead: number): void {
    const moves = this.moves;
    const stamps = movedBack(() => this.fresh(), moves, lead);
    this.moves = [];
    this.last = 0;
    this.synced = true;
    this.run = this.fresh();
    for (const [i, m] of moves.entries()) {
      this.last = stamps[i]!;
      const [st, at] = this.feed({ ...m, at: stamps[i]! });
      if (st === GOING) continue;
      this.mount();
      this.finish(at);
      return;
    }
    this.mount();
  }

  // The play ended before the server said when it began: the log waiting
  // to go is moved back by lead ms where it stands.
  private shift(lead: number): void {
    const log = this.sent;
    if (!log) return;
    const stamps = movedBack(() => this.fresh(), log.moves, lead);
    for (const [i, m] of log.moves.entries()) m.at = stamps[i]!;
    log.end = Math.max(stamps.at(-1) ?? 0, Math.trunc((log.end ?? 0) - lead));
    this.stopped = log.end;
  }

  private freeze(): void {
    if (this.phase === "play") this.stopped = this.now();
  }

  // The play is over on this side: the log goes to the server, which says
  // what it was.
  private finish(end: number): void {
    this.stopped = Math.max(end, this.moves.at(-1)?.at ?? 0);
    this.phase = "sending";
    this.reportDrops();
    const log = { moves: this.moves, end: this.stopped };
    this.sent = log;
    this.resends = 0;
    this.send(this.attempt, log);
    this.deps.changed();
  }

  private send(attempt: number, log: PuzzleLog): void {
    const m = this.machine;
    const sent = this.bench
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
    void sent.then((reply) => {
      if (attempt !== this.attempt) return;
      if (this.phase === "sending" && this.resendable(reply)) {
        this.resends++;
        this.deps.after(RESEND_MS, () => {
          if (attempt === this.attempt && this.phase === "sending") this.send(attempt, log);
        });
        return;
      }
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
  }

  // Whether a solve the world turned away should go again as it is. A
  // refused command is never stored, so the same log is safe to repeat,
  // and the machine is still armed until the server ends it.
  private resendable(reply: IntentReply): boolean {
    if (this.bench || reply.machine || !RESENDABLE.includes(reply.refusal?.code ?? ""))
      return false;
    const due = this.machine.due;
    return due ? this.deps.serverNow() < due : this.resends < RESENDS_UNTIMED;
  }

  // Back to rest, as if never touched: a refused arm.
  private reset(note: string): void {
    this.attempt++;
    this.phase = "rest";
    this.last = 0;
    this.moves = [];
    this.armedAt = undefined;
    this.synced = false;
    this.run = this.fresh();
    this.mount();
    this.say(note);
  }

  private say(note: string): void {
    this.note = note;
    this.deps.changed();
  }
}
