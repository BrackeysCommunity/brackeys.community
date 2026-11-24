import { type MachineView, type Option, type Theft, WhyAdapted } from "../api.ts";
import { button, el, lines, panel } from "../dom.ts";
import { adds, band, bandShort, level, percent, seconds } from "../units.ts";
import {
  adaptedLine,
  haywireLine,
  name,
  practiceLine,
  reasonLine,
  riskLine,
  sentence,
  witnessLine,
  witnessPartLine,
} from "../words.ts";

/**
 * What a theft's witness odds are made of, each part in per cent, and the
 * odds the world holds them at where the parts sum past its bounds.
 */
export function witnessList(t: Theft): HTMLElement {
  const list = el("ul", { class: "why" });
  const w = t.witnessWhy;
  const parts = w.parts ?? [];
  for (const p of parts) list.append(el("li", { text: witnessPartLine(p) }));
  for (const r of w.rules ?? []) list.append(el("li", { text: `Rule: ${r.replace(/-/g, " ")}` }));
  const sum = parts.reduce((n, p) => n + p.value, 0);
  if (parts.length && sum !== t.witness)
    list.append(el("li", { text: `Together ${percent(sum)}, held at ${percent(t.witness)}` }));
  for (const n of w.notes ?? []) list.append(el("li", { text: n }));
  if (!list.children.length) list.append(el("li", { text: `It stands at ${percent(t.witness)}` }));
  return list;
}

/** The why behind a theft's witness odds (GDD 6.5). */
export function witnessWhy(t: Theft, back: () => void): HTMLElement {
  const root = panel("Why: being seen");
  root.append(
    ...lines(
      witnessLine(t),
      "The odds were fixed when the theft began, and they are the odds rolled if it works.",
    ),
    witnessList(t),
    button("Back", back),
  );
  return root;
}

/**
 * The why view (GDD 8.4): the chain behind a modifier, each line a fact
 * with its unit. On a theft, what the witness odds are made of follows.
 */
export function optionWhy(o: Option, back: () => void, theft?: Theft): HTMLElement {
  const root = panel(`Why: ${name("fights.options", o.id)}`);
  const w = o.why;
  root.append(...lines(`${band(o.band)}, ${riskLine(o)}.`));
  const list = el("ul", { class: "why" });
  for (const p of w.parts ?? [])
    list.append(
      el("li", {
        text:
          p.label === WhyAdapted
            ? adaptedLine(p.value)
            : `${sentence(p.label)}: ${adds(p.value, p.unit)}`,
      }),
    );
  for (const r of w.rules ?? []) list.append(el("li", { text: `Rule: ${r.replace(/-/g, " ")}` }));
  if (w.bandFrom && w.bandTo && w.bandFrom !== w.bandTo)
    list.append(
      el("li", {
        text: `The rules moved it from ${bandShort(w.bandFrom)} to ${bandShort(w.bandTo)}`,
      }),
    );
  for (const n of w.notes ?? []) list.append(el("li", { text: n }));
  if (!list.children.length) list.append(el("li", { text: "Nothing changes this option." }));
  root.append(list);
  if (theft && witnessLine(theft))
    root.append(el("h3", { text: "Being seen" }), ...lines(witnessLine(theft)), witnessList(theft));
  root.append(button("Back", back));
  return root;
}

/** What a machine's countdown is made of, what it does when it fails, and what practice has bought. */
export function machineWhy(m: MachineView, back: () => void): HTMLElement {
  const root = panel(`Why: ${m.name}`);
  const list = el("ul", { class: "why" });
  if (m.level) list.append(el("li", { text: `The machine is ${level(m.level)}` }));
  else
    list.append(
      el("li", {
        text: "Its level, countdown and haywire show once it is armed. With more practice they show before you touch it",
      }),
    );
  for (const [i, r] of (m.why ?? []).entries())
    list.append(el("li", { text: reasonLine(r, i === 0) }));
  if (m.countdown) list.append(el("li", { text: `The countdown: ${seconds(m.countdown)}` }));
  if (m.haywire) list.append(el("li", { text: `If it fails. ${haywireLine(m.haywire)}` }));
  list.append(el("li", { text: `Your practice: ${practiceLine(m.practice)}` }));
  if (m.guide) list.append(el("li", { text: "Practice shows you a faint guide line" }));
  if (m.inner) list.append(el("li", { text: "Mastery opens a hidden panel behind the solve" }));
  root.append(
    list,
    ...lines("Practice buys time and information. It never changes whether a solve counts."),
    button("Back", back),
  );
  return root;
}
