import {
  ActBenchLesson,
  ActDeckSwap,
  ActDungeonLeave,
  ActDungeonPush,
  ActHuntPress,
  ActPartyPick,
  ActPress,
  MachineBench,
  MachineFork,
  MachinePouch,
  type ActivityState,
  type Fact,
  type HuntView,
  type MachineView,
  type Pressed,
  type Viewer,
} from "./api.ts";
import { button, el, lines, panel } from "./dom.ts";
import { streamed, type IntentBody, type Session } from "./session.ts";
import { MachinePanel } from "./shell/panel.ts";
import { versionOf } from "./shell/party-registry.ts";
import { familyOf } from "./shell/registry.ts";
import { plural, seconds } from "./units.ts";
import { beatView, pressedLines } from "./views/beat.ts";
import { benchView } from "./views/bench.ts";
import { floorView } from "./views/floor.ts";
import { huntView } from "./views/hunt.ts";
import { idleView } from "./views/idle.ts";
import { partyResult, partyResultLines, partyView, windowLine } from "./views/party.ts";
import { pouchesView } from "./views/pouches.ts";
import { machineWhy, optionWhy } from "./views/why.ts";
import { name, refusalLine } from "./words.ts";

export type Screen = "machine" | "beat" | "floor" | "hunt" | "party" | "pouches" | "bench" | "idle";

const TITLES: Record<Screen, string> = {
  machine: "Machine",
  beat: "The beat",
  floor: "The floor",
  hunt: "The hunt",
  party: "Party",
  pouches: "Pouches",
  bench: "Bench",
  idle: "Idle",
};

/** The screens a state offers, in the order the shell picks from. */
export function screens(st: ActivityState, machine: boolean): Screen[] {
  const out: Screen[] = [];
  if (st.machine || machine) out.push("machine");
  if (st.fight) out.push("beat");
  if (st.floor) out.push("floor");
  if (st.hunt) out.push("hunt");
  if (st.party) out.push("party");
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
  // At a fork the vote leads; the machine behind a way is a tab beside it.
  if (st.floor?.ways?.length && st.machine?.source === MachineFork) return "floor";
  return open[0]!;
}

// A machine is the same one while it is drawn the same in the same place.
// A party machine is also the one armed when it was, since a second
// arming can deal the same part again.
function key(m: MachineView): string {
  const armed = streamed(m) ? (m.armedAt ?? 0) : 0;
  return JSON.stringify([m.source, m.pouch ?? "", m.family, Boolean(m.compact), m.layout, armed]);
}

// structural: how often a pick window's line is read again, ms.
const WINDOW_EVERY = 500;

// The beat a party is on, to tell when it resolves for everyone.
function beatKey(st: ActivityState): string {
  const f = st.fight;
  return f?.shared ? `${f.id}/${f.beat}` : "";
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
  private beat = "";
  private resolved: string[] = [];
  private hunt: { before: HuntView | undefined; now: HuntView } | undefined;
  private ticking: ReturnType<typeof setTimeout> | undefined;

  constructor(
    root: HTMLElement,
    private readonly session: Session,
    private readonly compact: boolean,
  ) {
    root.replaceChildren(this.bar, this.nav, this.main);
    session.subscribe(() => this.render());
    session.onHint((m) => this.machine?.showHint(m));
    session.onMoves((ev) => {
      if (ev.kind === "move") this.machine?.relayed(ev.move);
      else this.machine?.resync(ev.moves);
    });
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
    this.tickWindows();
  }

  // A pick window's line counts down on the server's clock while one shows.
  private tickWindows(): void {
    if (this.ticking !== undefined) return;
    if (!this.main.isConnected || !this.main.querySelector("[data-due]")) return;
    this.ticking = setTimeout(() => {
      this.ticking = undefined;
      const now = this.session.serverNow();
      for (const node of this.main.querySelectorAll<HTMLElement>("[data-due]")) {
        const text = windowLine(Number(node.dataset.due), now, node.dataset.what ?? "");
        if (node.textContent !== text) node.textContent = text;
      }
      this.tickWindows();
    }, WINDOW_EVERY);
  }

  // What the state says has happened since it was last drawn: the party's
  // beat resolving for everyone, and the presses landing on a hunt.
  private noticeChanges(state: ActivityState): void {
    const beat = beatKey(state);
    if (this.beat && beat !== this.beat) {
      const r = partyResult(state.party);
      this.resolved = [
        "The beat resolved for everyone at once.",
        ...(r ? partyResultLines(r) : []),
      ];
    }
    this.beat = beat;
    const h = state.hunt;
    if (!h) this.hunt = undefined;
    else if (this.hunt?.now !== h) this.hunt = { before: this.hunt?.now, now: h };
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
    this.noticeChanges(state);
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
      const option = [...(state.fight?.options ?? []), ...(state.hunt?.options ?? [])].find(
        (o) => o.id === this.why?.option,
      );
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
            press: (option) =>
              void this.act(state.fight?.shared ? ActPartyPick : ActPress, { option }),
            why: (option) => this.openWhy({ option }),
            openMachine: () => this.go("machine"),
            swap: (item) => void this.act(ActDeckSwap, { item }),
            busy: this.busy,
            now: this.session.serverNow(),
          }),
        );
        return;
      case "floor":
        this.show(
          this.recent(),
          floorView(state, {
            push: (way) => void this.act(ActDungeonPush, { option: way }),
            leave: () => void this.act(ActDungeonLeave),
            openMachine: () => this.go("machine"),
            busy: this.busy,
            now: this.session.serverNow(),
          }),
        );
        return;
      case "hunt":
        this.show(
          this.recent(),
          huntView(
            state,
            {
              press: (target, option) => void this.act(ActHuntPress, { target, option }),
              why: (option) => this.openWhy({ option }),
              busy: this.busy,
            },
            this.hunt?.before,
          ),
        );
        return;
      case "party":
        this.show(this.recent(), partyView(state));
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
    const told = [
      this.notice,
      ...(this.last ? pressedLines(this.last) : []),
      ...this.resolved,
    ].filter(Boolean);
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
    const version = m?.party ? versionOf(m.party) : undefined;
    if (!m || !family || (m.party && !version)) return;
    this.machineKey = k;
    this.machine = new MachinePanel(
      {
        family,
        version,
        stream: (move) => this.session.move(move),
        known: () => this.session.partyLog(),
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

  private async act(kind: string, body: IntentBody = {}): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.notice = "";
    this.last = undefined;
    this.resolved = [];
    this.render();
    const reply = await this.session.intent(kind, body);
    this.busy = false;
    if (reply.ok) this.last = { pressed: reply.pressed ?? [], facts: reply.facts ?? [] };
    else this.notice = reply.refusal ? refusalLine(reply.refusal) : "The world did not take that.";
    this.render();
  }
}
