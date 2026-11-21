import {
  ActBenchLesson,
  ActPress,
  MachineBench,
  MachinePouch,
  type ActivityState,
  type Fact,
  type MachineView,
  type Pressed,
  type Viewer,
} from "./api.ts";
import { button, el, lines, panel } from "./dom.ts";
import type { IntentBody, Session } from "./session.ts";
import { MachinePanel } from "./shell/panel.ts";
import { familyOf } from "./shell/registry.ts";
import { plural, seconds } from "./units.ts";
import { beatView, pressedLines } from "./views/beat.ts";
import { benchView } from "./views/bench.ts";
import { idleView } from "./views/idle.ts";
import { pouchesView } from "./views/pouches.ts";
import { machineWhy, optionWhy } from "./views/why.ts";
import { name, refusalLine } from "./words.ts";

export type Screen = "machine" | "beat" | "pouches" | "bench" | "idle";

const TITLES: Record<Screen, string> = {
  machine: "Machine",
  beat: "The beat",
  pouches: "Pouches",
  bench: "Bench",
  idle: "Idle",
};

/** The screens a state offers, in the order the shell picks from. */
export function screens(st: ActivityState, machine: boolean): Screen[] {
  const out: Screen[] = [];
  if (st.machine || machine) out.push("machine");
  if (st.fight) out.push("beat");
  if (st.pouches?.length) out.push("pouches");
  if (st.bench) out.push("bench");
  return out.length ? out : ["idle"];
}

/**
 * What to open, since a launch carries no payload: an armed machine, a
 * machine beat, the encounter, pouches, the bench, or the idle view. A
 * machine in hand is never left; otherwise the player's own choice holds
 * while the state still offers it.
 */
export function pick(st: ActivityState, held: boolean, want: Screen | undefined): Screen {
  const open = screens(st, held);
  if (st.machine?.armed || held) return "machine";
  if (want && open.includes(want)) return want;
  return open[0]!;
}

// A machine is the same one while it is drawn the same in the same place.
function key(m: MachineView): string {
  return JSON.stringify([m.source, m.pouch ?? "", m.family, Boolean(m.compact), m.layout]);
}

/**
 * The Activity's one page: the context a character is in, drawn from the
 * newest state, and intents out. It keeps nothing the state does not say
 * except which screen is open and the machine in hand.
 */
export class App {
  private readonly bar = el("header", { class: "bar" });
  private readonly nav = el("nav", { class: "tabs" });
  private readonly main = el("main");
  private want: Screen | undefined;
  private why: { option?: string } | undefined;
  private machine: MachinePanel | undefined;
  private machineKey = "";
  private levels = new Map<string, number>();
  private busy = false;
  private notice = "";
  private last: { pressed: Pressed[]; facts: Fact[] } | undefined;
  private rendering = false;

  constructor(
    root: HTMLElement,
    private readonly session: Session,
    private readonly compact: boolean,
  ) {
    root.replaceChildren(this.bar, this.nav, this.main);
    session.subscribe(() => this.render());
    session.onHint((m) => this.machine?.showHint(m));
    this.render();
  }

  private viewer(extra: Partial<Viewer> = {}): Viewer {
    return { compact: this.compact, ...extra };
  }

  private render(): void {
    if (this.rendering) return;
    this.rendering = true;
    try {
      this.draw();
    } finally {
      this.rendering = false;
    }
  }

  // Replaces what main shows, leaving a node that is already there in
  // place: a machine taken out and put back would drop the drag on it.
  private show(...nodes: (HTMLElement | undefined)[]): void {
    const next = nodes.filter((n): n is HTMLElement => Boolean(n));
    const now = [...this.main.children];
    if (now.length === next.length && now.every((n, i) => n === next[i])) return;
    this.main.replaceChildren(...next);
  }

  private draw(): void {
    const { link, state } = this.session;
    this.drawBar(state);
    if (link.phase === "stopped") {
      this.dropMachine();
      this.nav.replaceChildren();
      this.show(
        panel(
          link.reason === "no-character" ? "No character yet" : "Not connected",
          ...lines(link.message),
          button(
            link.reason === "replaced" ? "Use it here" : "Try again",
            () => this.session.start(),
            {
              main: true,
            },
          ),
        ),
      );
      return;
    }
    if (!state) {
      this.nav.replaceChildren();
      this.show(panel("Opening", ...lines("Signing you in and finding your character.")));
      return;
    }
    this.syncMachine(state);
    const held = Boolean(this.machine && this.machine.shell.phase !== "rest");
    const open = screens(state, Boolean(this.machine));
    const screen = pick(state, held, this.want);
    this.nav.replaceChildren(
      ...(open.length > 1
        ? open.map((s) => {
            const tab = button(TITLES[s], () => this.go(s), { disabled: held && s !== "machine" });
            if (s === screen) tab.setAttribute("aria-current", "page");
            return tab;
          })
        : []),
    );
    if (this.why) {
      const back = () => {
        this.why = undefined;
        this.render();
      };
      const option = state.fight?.options.find((o) => o.id === this.why?.option);
      const machine = this.machine?.shell.machine ?? state.machine;
      const view = option
        ? optionWhy(option, back)
        : machine
          ? machineWhy(machine, back)
          : undefined;
      if (view) {
        this.show(view);
        return;
      }
      this.why = undefined;
    }
    switch (screen) {
      case "machine":
        this.show(this.machine?.root ?? this.unbuilt(state.machine));
        return;
      case "beat":
        this.show(
          this.recent(),
          beatView(state, {
            press: (option) => void this.act(ActPress, { option }),
            why: (option) => this.openWhy({ option }),
            openMachine: () => this.go("machine"),
            busy: this.busy,
          }),
        );
        return;
      case "pouches":
        this.show(
          this.recent(),
          pouchesView(state.pouches ?? [], (id) => {
            this.want = "machine";
            this.session.look(this.viewer({ pouch: id }));
          }),
        );
        return;
      case "bench":
        this.show(
          this.recent(),
          benchView(state.bench!, {
            levels: this.levels,
            rig: (family, level) => {
              this.want = "machine";
              this.session.look(this.viewer({ family, level }));
            },
            lesson: (family) => void this.act(ActBenchLesson, { machine: { family } }),
            repaint: () => this.render(),
            busy: this.busy,
          }),
        );
        return;
      case "idle":
        this.show(this.recent(), idleView(state));
        return;
    }
  }

  private drawBar(state: ActivityState | undefined): void {
    const { link } = this.session;
    const place = state
      ? state.place.name || name("map.terrain", state.place.tile.terrain)
      : "The wasteland";
    const here =
      state && state.place.busy > 1 ? `${plural(state.place.busy, "character")} here` : "";
    const line =
      link.phase === "retrying"
        ? `Connection lost. Trying again in ${seconds(link.inMs)}.`
        : link.phase === "connecting" && state
          ? "Reconnecting."
          : "";
    this.bar.replaceChildren(
      el("strong", { text: place }),
      el("span", { class: "muted", text: here }),
      el("span", { class: "link", text: line, attrs: { role: "status" } }),
    );
  }

  // What the last press or lesson did, or why the world turned it down.
  private recent(): HTMLElement | undefined {
    const told = [this.notice, ...(this.last ? pressedLines(this.last) : [])].filter(Boolean);
    return told.length ? panel("Just now", ...lines(...told)) : undefined;
  }

  // Keeps the machine in hand in step with the state; the machine decides
  // whether it stays, and a new one is built only when it gives way.
  private syncMachine(state: ActivityState): void {
    const m = state.machine;
    const k = m ? key(m) : "";
    if (this.machine?.take(m, k === this.machineKey, state.last?.result) === "kept") return;
    this.dropMachine();
    const family = m && familyOf(m.family);
    if (!m || !family) return;
    this.machineKey = k;
    this.machine = new MachinePanel(
      {
        family,
        serverNow: () => this.session.serverNow(),
        online: () => this.session.open,
        intent: (kind, body) => this.session.intent(kind, body),
        passHint: (move) => this.session.passHint(move),
        why: () => this.openWhy({}),
        close: (again) => this.closeMachine(again),
        changed: () => this.render(),
      },
      m,
    );
  }

  private dropMachine(): void {
    this.machine?.destroy();
    this.machine = undefined;
    this.machineKey = "";
  }

  // The result has been read. A bench rig is set up again or put away, a
  // pouch is put away, and a beat's machine gives way to whatever the
  // state says now.
  private closeMachine(again: boolean): void {
    const source = this.machine?.shell.machine.source;
    this.dropMachine();
    this.notice = "";
    this.last = undefined;
    if (source === MachineBench && !again) {
      this.want = "bench";
      this.session.look(this.viewer());
    } else if (source === MachinePouch) {
      this.want = "pouches";
      this.session.look(this.viewer());
    } else if (source !== MachineBench) {
      this.want = undefined;
    }
    this.render();
  }

  private unbuilt(m: MachineView | undefined): HTMLElement {
    return panel(
      m ? m.name : "No machine",
      ...lines(m ? "This machine cannot be drawn here yet." : "There is no machine here to work."),
    );
  }

  private go(screen: Screen): void {
    this.want = screen;
    this.why = undefined;
    this.render();
  }

  private openWhy(why: { option?: string }): void {
    this.why = why;
    this.render();
  }

  private async act(kind: string, body: IntentBody): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.notice = "";
    this.last = undefined;
    this.render();
    const reply = await this.session.intent(kind, body);
    this.busy = false;
    if (reply.ok) this.last = { pressed: reply.pressed ?? [], facts: reply.facts ?? [] };
    else this.notice = reply.refusal ? refusalLine(reply.refusal) : "The world did not take that.";
    this.render();
  }
}
