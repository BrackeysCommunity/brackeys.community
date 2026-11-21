import type { ActivityState, Fact, Option, Pressed } from "../api.ts";
import { button, el, lines, panel } from "../dom.ts";
import { band, outOf, ticks } from "../units.ts";
import { factLine, name, riskLine } from "../words.ts";

export interface BeatActions {
  press(option: string): void;
  why(option: string): void;
  openMachine(): void;
  /** A press is on its way; nothing else may be pressed. */
  busy: boolean;
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

/**
 * The beat a character faces: every option with its band and what it
 * risks, and the machine where the beat is one (GDD 7.3).
 */
export function beatView(st: ActivityState, act: BeatActions): HTMLElement {
  const f = st.fight!;
  const root = panel(
    `${name("fights.beats", f.kind)}: ${name("creatures.archetypes", f.creature)}`,
  );
  root.append(
    ...lines(
      `Beat ${outOf(f.beat + 1, f.beats, f.beats === 1 ? "beat" : "beats")}.`,
      f.ambush && f.default && f.due
        ? `An ambush. Unanswered, it resolves with ${name("fights.options", f.default)} in ${ticks(Math.max(0, f.due - st.tick))}.`
        : "",
    ),
  );
  const list = el("ul", { class: "options" });
  for (const o of f.options) {
    const row = el("li", { class: "option" });
    if (o.puzzle) {
      row.append(
        el("h3", { text: optionName(o) }),
        ...lines(
          `A machine, worked with your hands. ${band(o.band)} is how the world expects you to fare.`,
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
        el("h3", { text: optionName(o) }),
        ...lines(`${band(o.band)}, ${riskLine(o)}.`),
        el(
          "div",
          { class: "actions" },
          button(optionName(o), () => act.press(o.id), {
            main: o.kind === "win",
            disabled: act.busy,
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
