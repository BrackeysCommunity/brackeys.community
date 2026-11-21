import {
  MachineBeat,
  MachinePouch,
  type IntentReply,
  type MachineView,
  type PuzzleMove,
  type PuzzleResult,
} from "../api.ts";
import { beacon } from "../beacon.ts";
import { button, el, lines } from "../dom.ts";
import type { IntentBody } from "../session.ts";
import { level, plural, seconds, ticks } from "../units.ts";
import {
  factLine,
  haywireLine,
  leftLine,
  practiceLine,
  refusalLine,
  resultLine,
} from "../words.ts";
import type { Family } from "./kit.ts";
import { Shell } from "./shell.ts";

export interface PanelDeps {
  family: Family;
  serverNow(): number;
  online(): boolean;
  intent(kind: string, body: IntentBody, stale?: number): Promise<IntentReply>;
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
  private readonly surface = el("div", { class: "surface" });
  private readonly actions = el("div", { class: "actions" });
  private readonly result = el("div", { class: "result", attrs: { "aria-live": "assertive" } });
  private frame = 0;
  private shown = "";
  private phase = "";

  constructor(
    private readonly deps: PanelDeps,
    machine: MachineView,
  ) {
    this.clock.append(this.clockText, el("div", { class: "countdown-bar" }, this.clockFill));
    this.root = el(
      "section",
      { class: "machine" },
      this.head,
      this.status,
      this.clock,
      this.surface,
      this.actions,
      this.result,
    );
    this.shell = new Shell(
      {
        family: deps.family,
        surface: this.surface,
        wall: () => performance.now(),
        serverNow: () => deps.serverNow(),
        online: () => deps.online(),
        intent: (kind, body, stale) => deps.intent(kind, body, stale),
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
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
  }

  update(machine: MachineView): void {
    this.shell.update(machine);
  }

  conclude(result: PuzzleResult): void {
    this.shell.conclude(result);
  }

  showHint(m: PuzzleMove): void {
    this.shell.showHint(m);
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
    const where =
      m.source === MachineBeat
        ? "On this beat"
        : m.source === MachinePouch
          ? "A locked pouch"
          : "At the tinker's bench";
    const known = m.level ? `${m.name}, ${level(m.level)}` : m.name;
    this.head.replaceChildren(
      el("h2", { text: s.panel === 1 ? `${known}: the hidden panel` : known }),
      el("p", {
        class: "sub",
        text: `${where}. Your practice: ${practiceLine(p)}.`,
      }),
    );
    this.status.replaceChildren(...lines(s.note, this.statusLine()));
    this.root.dataset.phase = s.phase;
    this.root.dataset.panel = String(s.panel);

    // What can be pressed is laid out the same at rest and in play, so
    // arming a machine never moves the pieces under the finger.
    this.actions.replaceChildren();
    if (s.phase === "rest" || s.phase === "play") {
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
              s.markPassed();
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

    this.result.replaceChildren();
    if (s.phase === "done") this.result.append(...this.ending());
    if (s.phase !== this.phase) {
      this.phase = s.phase;
      this.deps.changed();
    }
  }

  private statusLine(): string {
    const s = this.shell;
    const m = s.machine;
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
  private drawClock(): void {
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
