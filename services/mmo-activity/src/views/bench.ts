import type { BenchFamily, BenchView } from "../api.ts";
import { button, el, lines, panel } from "../dom.ts";
import { familyOf } from "../shell/registry.ts";
import { level, outOf, plural, uses } from "../units.ts";

export interface BenchActions {
  /** The level picked for each family, kept while the bench is open. */
  levels: Map<string, number>;
  rig(family: string, level: number): void;
  lesson(family: string): void;
  repaint(): void;
  busy: boolean;
}

function picked(f: BenchFamily, levels: Map<string, number>): number {
  return Math.min(Math.max(levels.get(f.family) ?? f.maxLevel, 1), f.maxLevel);
}

/**
 * The tinker's bench (GDD 7.11): every family with its practice, a level
 * to set the rig to, lessons waiting, and what is left of today.
 */
export function benchView(b: BenchView, act: BenchActions): HTMLElement {
  const root = panel(`The tinker's bench at ${b.settlement}`);
  root.append(
    ...lines(
      "Practice rigs: no countdown, and a break costs nothing. A solve is practice.",
      `Bench practice today: ${outOf(b.uses, b.usesCap, "uses")}.`,
      `Lessons taken today: ${outOf(b.taken, b.takenCap, "lessons")}.`,
      b.families.some((f) => f.master)
        ? `Lessons given today: ${outOf(b.given, b.givenCap, "lessons")}.`
        : "",
    ),
  );
  const list = el("ul", { class: "options" });
  for (const f of b.families) {
    const at = picked(f, act.levels);
    const step = (by: number) => () => {
      act.levels.set(f.family, Math.min(Math.max(at + by, 1), f.maxLevel));
      act.repaint();
    };
    const p = f.practice;
    const built = Boolean(familyOf(f.family));
    list.append(
      el(
        "li",
        { class: "option" },
        el("h3", { text: p.title ? `${f.name} · ${p.title}` : f.name }),
        ...lines(
          `Practice ${level(p.level)}, ${uses(p.uses, p.need)} to the next.`,
          f.lessons > 0 ? `${plural(f.lessons, "lesson")} waiting from a master.` : "",
          built ? "" : "This rig is not built yet.",
        ),
        el(
          "div",
          { class: "actions" },
          el(
            "div",
            { class: "stepper", attrs: { role: "group", "aria-label": `${f.name} level` } },
            button("−", step(-1), { disabled: at <= 1 }),
            el("span", { text: sentence(level(at)) }),
            button("+", step(1), { disabled: at >= f.maxLevel }),
          ),
          button("Set it up", () => act.rig(f.family, at), { main: true, disabled: !built }),
          f.lessons > 0
            ? button("Take a lesson", () => act.lesson(f.family), {
                disabled: act.busy || b.taken >= b.takenCap,
              })
            : null,
        ),
      ),
    );
  }
  root.append(list);
  return root;
}

function sentence(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
