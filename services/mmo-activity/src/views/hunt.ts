import type { ActivityState, HuntView } from "../api.ts";
import { button, el, lines, panel } from "../dom.ts";
import { amount, band, outOf, percent, ticks } from "../units.ts";
import { goodsLine, name, riskLine, stagedLine } from "../words.ts";

export interface HuntActions {
  press(hunt: string, option: string): void;
  why(option: string): void;
  busy: boolean;
}

/**
 * The health each presser removed since the hunt was last shown, by name:
 * the presses as they land.
 */
export function landed(before: HuntView | undefined, now: HuntView): Map<string, number> {
  const out = new Map<string, number>();
  if (!before || before.id !== now.id) return out;
  const was = new Map(before.pressers.map((p) => [p.name, p.removed]));
  for (const p of now.pressers) {
    const d = p.removed - (was.get(p.name) ?? 0);
    if (d > 0 || !was.has(p.name)) out.set(p.name, d);
  }
  return out;
}

/**
 * A live hunt in reach (GDD 7.6): what is left of its pool, everyone's
 * part by health removed as the presses land, the viewer's share of the
 * spoils now, and the options it may press with this tick. A server's
 * staged hunt says who staged it, and its spoils stay where it was staged.
 */
export function huntView(st: ActivityState, act: HuntActions, before?: HuntView): HTMLElement {
  const h = st.hunt!;
  const root = panel(`${h.name}: ${name("creatures.archetypes", h.creature)}`);
  root.append(
    ...lines(
      h.placed ? `${stagedLine(h.placed)}.` : "",
      `${outOf(h.health, h.max, "health")} left.`,
      h.endsIn > 0
        ? `It moves on in ${ticks(h.endsIn)}: what is left unfinished pays nothing more.`
        : "It moves on at this tick.",
      h.mine > 0
        ? `You have removed ${amount(h.mine, "health")}: your share of the spoils now is ${percent(h.share)}.`
        : "You have not pressed it yet. The spoils are split by health removed.",
      h.spoils.length ? `Slain, it gives at most ${goodsLine(h.spoils, st.names)}.` : "",
    ),
  );
  const fresh = landed(before, h);
  const list = el("ul", { class: "why pressers" });
  for (const p of h.pressers) {
    const d = fresh.get(p.name);
    const li = el("li", {
      text: `${p.you ? `${p.name} (you)` : p.name}: ${amount(p.removed, "health")} removed${d ? `, ${amount(d, "health")} just now` : ""}`,
    });
    if (d) li.dataset.landed = "true";
    list.append(li);
  }
  if (h.pressers.length) root.append(el("h3", { text: "Who has pressed it" }), list);
  if (!h.canPress) {
    root.append(
      ...lines(
        h.pressers.some((p) => p.you)
          ? "You have pressed this tick. The next tick lets you press again."
          : "You cannot press it from where you are now.",
      ),
    );
    return root;
  }
  const options = el("ul", { class: "options" });
  for (const o of h.options ?? []) {
    options.append(
      el(
        "li",
        { class: "option" },
        el("h3", { text: name("fights.options", o.id) }),
        ...lines(`${band(o.band)}, ${riskLine(o)}.`),
        el(
          "div",
          { class: "actions" },
          button(name("fights.options", o.id), () => act.press(h.id, o.id), {
            main: o.kind === "win",
            disabled: act.busy,
          }),
          button("Why", () => act.why(o.id)),
        ),
      ),
    );
  }
  root.append(options);
  return root;
}
