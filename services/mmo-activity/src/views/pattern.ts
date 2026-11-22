import "./pattern.css";
import type { PatternPoint } from "../api.ts";
import { el, lines } from "../dom.ts";
import { plural } from "../units.ts";
import { clueLine, heldLine, name, pointName, sentence } from "../words.ts";

const KINDS: Record<string, string> = {
  order: "an order",
  state: "settings",
  alignment: "facings",
  connection: "live runs",
  completion: "the missing one",
  constellation: "the hidden one",
};

/**
 * The strip over a pattern's point (GDD 4.13): the board's points, what
 * the viewer knows is held where it stands, how long a held point lasts
 * and the clues found. It says what the server sent and nothing it could
 * work out: no rule of the pattern and never its answer.
 */
export function patternParts(p: PatternPoint, open: boolean): HTMLDetailsElement {
  const here = pointName(p.point);
  const place = p.place.toLowerCase();
  const pips = el("ul", { class: "pattern-points" });
  for (let i = 0; i < Math.max(p.points, 1); i++) {
    const pip = el("li", { text: pointName(i) });
    if (i === p.point) pip.setAttribute("aria-current", "location");
    pips.append(pip);
  }
  const summary = el(
    "summary",
    {},
    el("h2", { text: `Pattern: ${KINDS[p.kind] ?? sentence(p.kind)}` }),
    pips,
  );
  const which =
    p.points > 1
      ? `This ${place} is point ${here} of points A to ${pointName(p.points - 1)}.`
      : `This ${place} is the pattern's one point.`;
  const held =
    p.held === undefined
      ? "Nothing is held here yet."
      : `Point ${here} ${heldLine(p.kind, p.held)}.`;
  const setBy = p.family
    ? `It is set in chat, and its ${name("puzzles.families", p.family)} machine commits it here.`
    : "It is set by a delivery in chat.";
  const lapse = p.lapseDays
    ? `What a point holds lapses after ${plural(p.lapseDays, "world day")} unless the pattern is solved.`
    : "";
  const clues = p.clues ?? [];
  const found = clues.length
    ? el("ul", { class: "why" }, ...clues.map((f) => el("li", { text: clueLine(f, p.points) })))
    : el("p", { class: "muted", text: "None yet. They lie on tiles about the pattern." });
  const details = el(
    "details",
    {},
    summary,
    ...lines(
      which,
      held,
      "Other points show what they hold only where they stand.",
      p.solved ? "Solved. What it opened is told in chat." : setBy,
      p.solved ? "" : lapse,
    ),
    el("h3", { text: "Clues found" }),
    found,
  );
  details.open = open;
  return details;
}

/**
 * The strip as one node that stays put while the machine under it is
 * worked, so the page never takes the machine out to redraw it.
 */
export class PatternStrip {
  readonly root = el("section", { class: "panel pattern" });
  private key = "";
  private point = "";
  private chosen: boolean | undefined;

  /** Draws p, open or shut as asked unless the viewer has chosen at this point. */
  show(p: PatternPoint, open: boolean): HTMLElement {
    const point = `${p.board}/${p.point}`;
    if (point !== this.point) this.chosen = undefined;
    const key = JSON.stringify([p, this.chosen ?? open]);
    if (key === this.key) return this.root;
    this.key = key;
    this.point = point;
    const shown = this.chosen ?? open;
    const details = patternParts(p, shown);
    // Opening it in code fires a toggle too; only the viewer's own counts.
    details.addEventListener("toggle", () => {
      if (details.open === shown && this.chosen === undefined) return;
      this.chosen = details.open;
    });
    this.root.replaceChildren(details);
    return this.root;
  }
}
