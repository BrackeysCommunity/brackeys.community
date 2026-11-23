import type { PouchView } from "../api.ts";
import { button, el, lines, panel } from "../dom.ts";
import { familyOf } from "../shell/registry.ts";
import { plural, ticks } from "../units.ts";
import { goodsLine, type Found } from "../words.ts";

/** Locked pouches: what each holds and the lock on it. Opening one pays exactly what it holds. */
export function pouchesView(
  pouches: PouchView[],
  open: (id: string) => void,
  found?: Found,
): HTMLElement {
  const root = panel(`Locked pouches: ${plural(pouches.length, "pouch", "pouches")}`);
  root.append(
    ...lines("Each holds what was found, behind a lock. Solving the lock pays exactly that."),
  );
  const list = el("ul", { class: "options" });
  for (const p of pouches) {
    const built = Boolean(familyOf(p.family));
    list.append(
      el(
        "li",
        { class: "option" },
        el("h3", { text: p.name }),
        ...lines(
          `Holds ${goodsLine(p.goods, found)}.`,
          p.locked ? `Shut after a haywire: ${ticks(p.locked)} until it can be tried again.` : "",
          built ? "" : "This lock is not built yet.",
        ),
        el(
          "div",
          { class: "actions" },
          button("Work the lock", () => open(p.id), {
            main: true,
            disabled: Boolean(p.locked) || !built,
          }),
        ),
      ),
    );
  }
  root.append(list);
  return root;
}
