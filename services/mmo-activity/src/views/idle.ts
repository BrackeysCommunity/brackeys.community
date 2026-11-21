import type { ActivityState } from "../api.ts";
import { el, lines, panel } from "../dom.ts";
import { level } from "../units.ts";
import { name, named } from "../words.ts";

/** Nothing here needs hands: point back to chat, and show what practice has earned. */
export function idleView(st: ActivityState): HTMLElement {
  const root = panel("Nothing here needs your hands");
  root.append(
    ...lines(
      "Machines, locked pouches and the tinker's bench open here. Everything else is in chat: press Hub there to carry on.",
      st.character.long
        ? "You are in the middle of something long. It runs while you are away."
        : "",
    ),
  );
  const titles = new Set(st.character.titles ?? []);
  const practised = st.character.practice.filter(
    (s) => s.level > 0 && named("puzzles.families", s.id),
  );
  if (practised.length) {
    const list = el("ul", { class: "why" });
    for (const s of practised) {
      const title = titles.has(s.id) ? `, ${name("puzzles.titles", s.id)}` : "";
      list.append(
        el("li", { text: `${name("puzzles.families", s.id)}: ${level(s.level)}${title}` }),
      );
    }
    root.append(el("h3", { text: "Your practice with machines" }), list);
  }
  return root;
}
