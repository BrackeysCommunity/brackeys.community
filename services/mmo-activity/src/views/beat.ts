import type { ActivityState, DeckView, Fact, Fight, Option, Pressed } from "../api.ts";
import { button, el, lines, panel } from "../dom.ts";
import { svg } from "../shell/board.ts";
import { band, outOf, ticks } from "../units.ts";
import { beatLine, creatureAlt, creatureName, factLine, name, riskLine } from "../words.ts";
import { memberLine, windowNode } from "./party.ts";

export interface BeatActions {
  press(option: string): void;
  why(option: string): void;
  openMachine(): void;
  /** Swaps the off-hand deck for one carried in the pack. */
  swap?(deck: string): void;
  /** A press is on its way; nothing else may be pressed. */
  busy: boolean;
  /** The server's clock, unix ms, for a pick window. */
  now?: number;
}

/** The decks a beat offers to swap in, when the state lists any. */
export function decksOf(f: Fight): DeckView[] {
  return f.decks ?? [];
}

function optionName(o: Option): string {
  return name("fights.options", o.id);
}

/** What the last press did, in the words of the card that would have shown it. */
export function pressedLines(last: { pressed: Pressed[]; facts: Fact[] }): string[] {
  return [
    ...last.pressed.map(
      (p) =>
        `${name("fights.options", p.option)} at ${band(p.band).toLowerCase()}: ${p.success ? "it worked" : "it failed"}.`,
    ),
    ...last.facts.map(factLine),
  ];
}

// The party's side of a shared beat: who has chosen, never what, the
// viewer's own pick, and the window the server's clock closes.
function sharedLines(st: ActivityState, f: Fight, act: BeatActions): HTMLElement[] {
  const b = st.party?.beat;
  const out: HTMLElement[] = [];
  if (b) {
    out.push(
      ...lines(
        `${b.picked} of ${b.present} members have chosen.`,
        b.mine
          ? `Your pick: ${name("fights.options", b.mine)}. It stands until the beat resolves for everyone at once.`
          : `${name("fights.options", b.cautious)} is what you take if the window closes before you choose.`,
        b.waiting ? "The window waits while the party works its machine." : "",
      ),
    );
    if (b.due && !b.waiting) out.push(windowNode(b.due, act.now ?? b.due, "to pick"));
  }
  const members = f.party ?? [];
  if (members.length) {
    const list = el("ul", { class: "why seats" });
    for (const m of members) {
      const li = el("li", { text: memberLine(m, st.floor?.up) });
      if (m.picked) li.dataset.picked = "true";
      list.append(li);
    }
    out.push(list);
  }
  return out;
}

// structural: the beat track's pip radius and spacing, in its own units.
const PIP = 7;
const PIP_GAP = 22;

// The beat track: a pip a beat, those behind filled, this one ringed.
function beatTrack(f: Fight): SVGSVGElement {
  const n = Math.max(1, f.beats);
  const width = PIP_GAP * n;
  const track = svg("svg", {
    class: "beat-track",
    viewBox: `0 0 ${width} ${PIP_GAP}`,
    role: "img",
    "aria-label": creatureAlt(f),
  });
  const mid = PIP_GAP / 2;
  track.append(
    svg("line", {
      class: "beat-rule",
      x1: mid,
      y1: mid,
      x2: width - mid,
      y2: mid,
      "aria-hidden": "true",
    }),
  );
  for (let i = 0; i < n; i++) {
    const at = i < f.beat ? "past" : i === f.beat ? "now" : "ahead";
    track.append(
      svg("circle", { class: `beat-pip ${at}`, cx: mid + i * PIP_GAP, cy: mid, r: PIP }),
    );
  }
  return track;
}

/** The creature panel: the beat track, and the setting's line for this beat. */
export function creaturePanel(st: ActivityState): HTMLElement {
  const f = st.fight!;
  const line = beatLine(st);
  return el(
    "div",
    { class: "creature" },
    beatTrack(f),
    line ? el("p", { class: "encounter", text: line }) : null,
  );
}

// The second slot: a deck carried in the pack, swapped in before the pick.
function deckRow(f: Fight, act: BeatActions, picked: boolean): HTMLElement | undefined {
  const decks = decksOf(f);
  if (!decks.length || !act.swap) return undefined;
  const row = el("div", { class: "actions" });
  for (const d of decks)
    row.append(
      button(`Swap in ${d.name}`, () => act.swap?.(d.id), { disabled: act.busy || picked }),
    );
  return el(
    "div",
    { class: "option" },
    el("h3", { text: "Your second deck" }),
    ...lines("Swap the deck in your off hand once a beat, before you choose."),
    row,
  );
}

/**
 * The beat a character faces: every option with its band and what it
 * risks, and the machine where the beat is one (GDD 7.3). On a party's
 * shared beat it says who has chosen and how long the window has, and a
 * choice waits there until the beat resolves for everyone at once.
 */
export function beatView(st: ActivityState, act: BeatActions): HTMLElement {
  const f = st.fight!;
  const mine = f.shared ? st.party?.beat?.mine : undefined;
  const root = panel(`${name("fights.beats", f.kind)}: ${creatureName(f)}`);
  root.append(
    creaturePanel(st),
    ...lines(
      `Beat ${outOf(f.beat + 1, f.beats, f.beats === 1 ? "beat" : "beats")}${f.floor ? `, on floor ${f.floor}` : ""}${f.shared ? ", with your party" : ""}.`,
      f.hidden ? "You are hidden from it for now." : "",
      f.ambush && f.default && f.due
        ? `An ambush. Unanswered, it resolves with ${name("fights.options", f.default)} in ${ticks(Math.max(0, f.due - st.tick))}.`
        : "",
    ),
  );
  if (f.shared) root.append(...sharedLines(st, f, act));
  const deck = deckRow(f, act, Boolean(mine));
  if (deck) root.append(deck);
  const list = el("ul", { class: "options" });
  for (const o of f.options) {
    const row = el("li", { class: "option" });
    if (mine === o.id) row.dataset.mine = "true";
    if (o.puzzle) {
      row.append(
        el("h3", { text: optionName(o) }),
        ...lines(
          f.shared
            ? `A machine the party works together, each with your own hands. ${band(o.band)} is how the world expects you to fare.`
            : `A machine, worked with your hands. ${band(o.band)} is how the world expects you to fare.`,
        ),
        el(
          "div",
          { class: "actions" },
          button("Open the machine", () => act.openMachine(), {
            main: true,
            disabled: !st.machine,
          }),
          button("Why", () => act.why(o.id)),
        ),
      );
    } else {
      row.append(
        el("h3", { text: mine === o.id ? `${optionName(o)}: your pick` : optionName(o) }),
        ...lines(`${band(o.band)}, ${riskLine(o)}.`),
        el(
          "div",
          { class: "actions" },
          button(optionName(o), () => act.press(o.id), {
            main: o.kind === "win",
            disabled: act.busy || Boolean(mine),
          }),
          button("Why", () => act.why(o.id)),
        ),
      );
    }
    list.append(row);
  }
  root.append(list);
  return root;
}
