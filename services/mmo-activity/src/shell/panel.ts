import {
  MachineBeat,
  MachineFork,
  MachineGuardian,
  MachineParty,
  MachinePattern,
  MachinePouch,
  type IntentReply,
  type MachineView,
  type PuzzleMove,
  type PuzzleResult,
  type SeatView,
} from "../api.ts";
import { beacon } from "../beacon.ts";
import { button, el, lines } from "../dom.ts";
import type { IntentBody } from "../session.ts";
import { level, plural, seconds, ticks } from "../units.ts";
import {
  factLine,
  haywireLine,
  leftLine,
  machineAlt,
  practiceLine,
  refusalLine,
  resultLine,
  stagedLine,
  type MachineState,
} from "../words.ts";
import { labelBoards } from "./board.ts";
import { BROKE, DONE, type Family } from "./kit.ts";
import type { PartyVersion } from "./party-registry.ts";
import { Shell } from "./shell.ts";

/**
 * Another crew working the same fork machine from its own context. The
 * first solve to land takes the machine, and the other side's haywires.
 */
export interface RivalView {
  name: string;
  armedAt: number; // unix ms
  moves?: number;
}

/** A machine's rival, when the state names one. */
export function rivalOf(m: MachineView): RivalView | undefined {
  return (m as MachineView & { rival?: RivalView }).rival;
}

// structural: the place a competing vault's machine stands at, before its stage id.
const VAULT = "vault:";

/** Where a machine stands and who staged it, on a competing vault. */
export type VaultMark = Pick<MachineView, "place" | "placed">;

/**
 * A competing vault a server staged (GDD 14.4), when the machine is one:
 * its fork machine's place names the stage, and the state says who staged it.
 */
export function vaultOf(m: MachineView): VaultMark | undefined {
  return m.place?.startsWith(VAULT) ? { place: m.place, placed: m.placed } : undefined;
}

/** Who sits at a party machine, by name, and who of them has it open here. */
export function seatsLine(seats: SeatView[]): string {
  const names = seats.map((s) => {
    const who = s.you ? `${s.name} (you)` : s.name;
    return s.moved ? `${who}, moved` : who;
  });
  return `At the machine: ${names.join("; ")}.`;
}

/** Whether everyone who must sit at a party machine has it open in this Activity. */
export function allSeated(seats: SeatView[] | undefined): boolean {
  return Boolean(seats?.length) && seats!.every((s) => s.here);
}

export interface PanelDeps {
  family: Family;
  version?: PartyVersion;
  /** Streams one move of a party machine. */
  stream?(m: PuzzleMove): boolean;
  /** The party machine's merged log so far. */
  known?(): PuzzleMove[];
  serverNow(): number;
  online(): boolean;
  intent(kind: string, body: IntentBody): Promise<IntentReply>;
  passHint(m: PuzzleMove): void;
  /** Opens the machine's why. */
  why(): void;
  /** The player is finished with the result. `again` asks the bench for another rig. */
  close(again: boolean): void;
  /** The machine moved from one phase to another. */
  changed(): void;
}

/**
 * The frame round a machine: its name and practice, the study note, the
 * countdown read from the server's deadline, hints, and the result as the
 * server gave it. The play surface inside belongs to the scene.
 */
export class MachinePanel {
  readonly root: HTMLElement;
  readonly shell: Shell;

  private readonly head = el("header", { class: "machine-head" });
  private readonly status = el("div", {
    class: "machine-status",
    attrs: { "aria-live": "polite" },
  });
  private readonly clock = el("div", { class: "countdown" });
  private readonly clockText = el("span", { class: "countdown-text" });
  private readonly clockFill = el("div", { class: "countdown-fill" });
  private readonly seats = el("div", { class: "machine-seats", attrs: { "aria-live": "polite" } });
  private readonly rival = el("div", { class: "countdown rival" });
  private readonly rivalText = el("span", { class: "countdown-text" });
  private readonly rivalFill = el("div", { class: "countdown-fill" });
  private readonly surface = el("div", { class: "surface" });
  private readonly actions = el("div", { class: "actions" });
  private readonly result = el("div", { class: "result", attrs: { "aria-live": "assertive" } });
  private frame = 0;
  private shown = "";
  private rivalShown = "";
  private phase = "";

  constructor(
    private readonly deps: PanelDeps,
    machine: MachineView,
  ) {
    this.clock.append(this.clockText, el("div", { class: "countdown-bar" }, this.clockFill));
    this.rival.append(this.rivalText, el("div", { class: "countdown-bar" }, this.rivalFill));
    this.rival.hidden = true;
    this.root = el(
      "section",
      { class: "machine" },
      this.head,
      this.status,
      this.seats,
      this.clock,
      this.rival,
      this.surface,
      this.actions,
      this.result,
    );
    this.shell = new Shell(
      {
        family: deps.family,
        version: deps.version,
        stream: (m) => deps.stream?.(m) ?? false,
        known: () => deps.known?.() ?? [],
        surface: this.surface,
        wall: () => performance.now(),
        serverNow: () => deps.serverNow(),
        online: () => deps.online(),
        intent: (kind, body) => deps.intent(kind, body),
        after: (ms, f) => {
          const id = setTimeout(f, ms);
          return () => clearTimeout(id);
        },
        beacon,
        changed: () => this.render(),
      },
      machine,
    );
    this.render();
    const loop = () => {
      this.shell.tick();
      this.drawClock();
      this.label();
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  /** The newest state's machine: see Shell.take. */
  take(
    machine: MachineView | undefined,
    same: boolean,
    last: PuzzleResult | undefined,
  ): "kept" | "replace" {
    return this.shell.take(machine, same, last);
  }

  showHint(m: PuzzleMove): void {
    this.shell.showHint(m);
  }

  /** A move another seat made on this party machine. */
  relayed(m: PuzzleMove): void {
    this.shell.relayed(m);
  }

  /** The merged log as the gateway holds it. */
  resync(moves: PuzzleMove[]): void {
    this.shell.resync(moves);
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.shell.destroy();
    this.root.remove();
  }

  private render(): void {
    const s = this.shell;
    const m = s.machine;
    const p = m.practice;
    const vault = vaultOf(m);
    const where = vault
      ? "In a competing vault: the first crew to solve it takes it"
      : m.source === MachineBeat
        ? "On this beat"
        : m.source === MachineParty
          ? "On this beat, with your party"
          : m.source === MachineFork
            ? "Behind a way down"
            : m.source === MachineGuardian
              ? "On the guardian"
              : m.source === MachinePouch
                ? "A locked pouch"
                : m.source === MachinePattern
                  ? "At a pattern's point"
                  : "At the tinker's bench";
    const known = m.level ? `${m.name}, ${level(m.level)}` : m.name;
    this.head.replaceChildren(
      el("h2", { text: s.panel === 1 ? `${known}: the hidden panel` : known }),
      el("p", {
        class: "sub",
        text: `${where}. Your practice: ${practiceLine(p)}.`,
      }),
      ...(vault?.placed ? [el("p", { class: "sub", text: `${stagedLine(vault.placed)}.` })] : []),
    );
    this.status.replaceChildren(...lines(s.note, this.statusLine()));
    this.seats.replaceChildren(
      ...lines(
        m.seats?.length ? seatsLine(m.seats) : "",
        m.glimpse ? "Your practice gives you a glimpse of the next seat's part." : "",
      ),
    );
    this.root.dataset.phase = s.phase;
    this.root.dataset.panel = String(s.panel);

    // What can be pressed is laid out the same at rest and in play, so
    // arming a machine never moves the pieces under the finger.
    this.actions.replaceChildren();
    if (s.launchable) {
      const ready = allSeated(m.seats);
      this.actions.append(
        button("Start it for everyone", () => s.launch(), { main: true, disabled: !ready }),
        button("Why", () => this.deps.why()),
      );
    } else if (s.phase === "rest" || s.phase === "play") {
      if (m.hints?.length && s.panel === 0) {
        const left = s.hintsLeft();
        this.actions.append(
          button(`Show a hint (${plural(left, "hint")} left)`, () => s.hint(), {
            disabled: left === 0,
          }),
        );
      }
      if (p.title && !s.bench && s.panel === 0) {
        const pass = s.passable();
        this.actions.append(
          button(
            "Pass a hint to the others",
            () => {
              if (!pass) return;
              this.deps.passHint(pass);
            },
            { disabled: !pass },
          ),
        );
      }
      this.actions.append(button("Why", () => this.deps.why()));
      if (s.bench) {
        if (p.title) this.actions.append(this.teachBox());
        this.actions.append(
          button("Give up on this one", () => s.leave(), { disabled: !s.leavable() }),
        );
      } else if (s.leavable()) {
        this.actions.append(button("Leave the hidden panel", () => s.leave()));
      }
    }

    this.label();
    this.result.replaceChildren();
    if (s.phase === "done") this.result.append(...this.ending());
    if (s.phase !== this.phase) {
      this.phase = s.phase;
      this.deps.changed();
    }
  }

  // A scene is remounted for a hidden panel or a replay, so its drawing is
  // named again each frame; set() writes only a change.
  private label(): void {
    const m = this.shell.machine;
    const state = this.machineState();
    labelBoards(this.surface, (scene) => machineAlt(m, state, scene));
  }

  private machineState(): MachineState {
    const s = this.shell;
    switch (s.phase) {
      case "rest":
        return s.machine.locked ? "locked" : s.bench ? "bench" : "rest";
      case "play":
        return s.panel === 1 ? "hidden-panel" : s.bench ? "working" : "armed";
      case "sending":
        return "sending";
      case "done":
        return "done";
    }
  }

  private statusLine(): string {
    const s = this.shell;
    const m = s.machine;
    if (s.party) return this.partyLine();
    switch (s.phase) {
      case "rest":
        if (m.locked) return `This machine has locked you out for ${ticks(m.locked)}.`;
        if (s.bench)
          return m.maxPlay
            ? `A practice rig. No countdown, and a break costs nothing. A rig left on the bench ${seconds(m.maxPlay)} is set aside for another.`
            : "A practice rig. No countdown, and a break costs nothing.";
        if (m.intro)
          return "Your first machine. Nothing starts until you touch it; its worst is a jolt.";
        return m.countdown
          ? `Study it as long as you like. The first touch starts ${seconds(m.countdown)} on the clock.`
          : "Study it as long as you like. The first touch starts the countdown.";
      case "play":
        if (s.panel === 1)
          return "Solved. A hidden panel opened: solve it too in time, or leave it.";
        return s.bench ? "Working. Take the time you need." : "Armed. Walking away is a haywire.";
      case "sending":
        return "Sending what you did to the world.";
      case "done":
        return "";
    }
  }

  private partyLine(): string {
    const s = this.shell;
    const m = s.machine;
    switch (s.phase) {
      case "rest":
        return allSeated(m.seats)
          ? "Everyone at it has it open. The first touch starts it for all of you at once, and its size and countdown are set then."
          : "It starts only when everyone at it has it open here. Waiting for the others.";
      case "play":
        if (s.looks === DONE)
          return "Your screen reads it solved. The world is checking every hand's moves.";
        if (s.looks === BROKE)
          return "Your screen reads it broken. The world is checking every hand's moves.";
        return "Armed for everyone. Every hand's moves count as one machine.";
      case "sending":
        return "The countdown is up. The world is reading every hand's moves.";
      case "done":
        return "";
    }
  }

  private teachBox(): HTMLElement {
    const box = el("input", { attrs: { type: "checkbox" } });
    box.checked = this.shell.teach;
    box.addEventListener("change", () => {
      this.shell.teach = box.checked;
    });
    return el("label", { class: "check" }, box, "Leave this solve as a lesson");
  }

  private ending(): HTMLElement[] {
    const s = this.shell;
    const e = s.ending;
    const out: HTMLElement[] = [];
    if (e?.result) {
      out.push(el("h3", { text: resultLine(e.result, s.bench) }));
      const hay = s.machine.haywire;
      if (e.result.haywire)
        out.push(
          ...lines(
            hay && hay.id === e.result.haywire
              ? haywireLine(hay)
              : `Haywire: ${e.result.haywire.replace(/-/g, " ")}.`,
          ),
        );
    } else if (e?.refusal) {
      out.push(
        el("h3", { text: "The world would not take it." }),
        ...lines(refusalLine(e.refusal)),
      );
    } else {
      out.push(el("h3", { text: "The machine is no longer yours to work." }));
    }
    out.push(...lines(...(e?.facts ?? []).map(factLine)));
    const row = el("div", { class: "actions" });
    if (s.bench)
      row.append(
        button("Another machine", () => this.deps.close(true), { main: true }),
        button("Back to the bench", () => this.deps.close(false)),
      );
    else row.append(button("Carry on", () => this.deps.close(false), { main: true }));
    out.push(row);
    return out;
  }

  // The countdown is read from the server's deadline every frame; the DOM
  // is touched only when the reading changes. Its row is there from the
  // start, so the play surface keeps its size when the clock begins.
  // A rival crew's time on the same machine, from when it armed.
  private drawRival(): void {
    const m = this.shell.machine;
    const r = rivalOf(m);
    this.rival.hidden = !r;
    if (!r) return;
    const elapsed = Math.max(0, this.deps.serverNow() - r.armedAt);
    const of = m.countdown ?? 0;
    const text = `A rival crew, ${r.name}'s, is on this machine: ${seconds(elapsed)} in${
      r.moves !== undefined ? `, and it has moved ${plural(r.moves, "time")}` : ""
    }.`;
    if (text === this.rivalShown) return;
    this.rivalShown = text;
    this.rivalText.textContent = text;
    this.rivalFill.style.width = `${of ? Math.min(1, elapsed / of) * 100 : 0}%`;
  }

  private drawClock(): void {
    this.drawRival();
    const s = this.shell;
    if (s.bench) {
      this.clock.hidden = true;
      return;
    }
    if (s.phase === "sending" || s.phase === "done") return;
    const left = s.left();
    let text = "At rest";
    let fill = 1;
    if (s.phase === "play") {
      if (left === undefined) text = "Arming";
      else {
        text = leftLine(left);
        fill = s.machine.countdown ? Math.min(1, left / s.machine.countdown) : 1;
      }
    }
    const key = `${text}|${Math.round(fill * 200)}`;
    if (key === this.shown) return;
    this.shown = key;
    this.clockText.textContent = text;
    this.clockFill.style.width = `${fill * 100}%`;
    this.clock.classList.toggle("low", left !== undefined && left <= 10_000);
  }
}
