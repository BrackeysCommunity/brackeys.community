import { type Button, type Row } from "../../../../packages/discord-kit/src/index.ts";
import type * as api from "../api.ts";
import { authorLine, type Card, COLOUR } from "../card.ts";
import { encodeId, target } from "../ids.ts";
import { capitalise } from "../lexicon.ts";
import { num, plural } from "../units.ts";
import { back, btn, buttonLabel, option, PRIVATE, ROW_MOST, SELECT_MOST } from "./common.ts";

/**
 * Classes (GDD 5.8, 5.9): nobody picks one; each unlocks by what was
 * practised. The card shows every class's thresholds and how far along
 * you are, and for one class its tree: two abilities a tier, one taken.
 */

export function classesCard(o: api.Options, c: api.Classes, focus?: string, notice?: string): Card {
  const v = o.version;
  const shown =
    c.classes.find((x) => x.id === focus) ?? c.classes.find((x) => x.earned) ?? c.classes[0];
  const rows: Row[] = [
    {
      select: {
        customId: encodeId("classes", "", v),
        placeholder: shown ? `Showing: ${shown.name}` : "Pick a class",
        options: c.classes
          .filter((x) => x.id !== shown?.id)
          .map((x) => option(x.name, x.id, x.earned ? `level ${x.level}` : "not yet earned")),
      },
    },
  ];
  const acts: Button[] = [];
  if (shown?.earned && !shown.active && c.here)
    acts.push(btn(`Make ${shown.name} active`, "cls-choose", shown.id, v, { style: "primary" }));
  // An ability whose system is not built yet is shown and not offered: a
  // tier's one pick is not spent on a rule that does nothing.
  if (shown?.active)
    for (const t of shown.tiers)
      if (t.open && !t.options.some((a) => a.taken))
        for (const a of t.options.filter((a) => !a.waits))
          acts.push(
            btn(buttonLabel(`Take: ${a.name}`), "cls-take", target(":", shown.id, a.id), v, {
              style: "success",
            }),
          );
  // Mark prey is an act, not a rule: its holder names one creature tag a day.
  if (c.prey && !c.prey.today)
    rows.push({
      select: {
        customId: encodeId("cls-mark", shown?.id ?? "", v),
        placeholder: "Mark prey: one kind of creature, for today",
        options: c.prey.tags.slice(0, SELECT_MOST).map((t) => option(capitalise(t), t)),
      },
    });
  const nav = [btn("Character", "character", "", v), back(v)];
  rows.push({ buttons: [...acts.slice(0, ROW_MOST - nav.length), ...nav] });
  const tree =
    shown?.tiers.map((t) => [
      `level ${t.level}`,
      t.options
        .map((a) => `${a.taken ? "✓ " : ""}${a.name}${a.waits ? " (later)" : ""}`)
        .join(" / ")
        .slice(0, 44),
      t.open ? "open" : "shut",
    ]) ?? [];
  return {
    context: PRIVATE,
    author: authorLine(
      "Classes",
      `${num(c.active)} of ${plural(c.most, "class", "classes")} active`,
    ),
    title:
      notice ??
      (shown ? `${shown.name}${shown.earned ? `, level ${shown.level}` : ""}` : "Classes"),
    picture: "form",
    description: shown
      ? `${shown.leans}.${shown.first ? " You were the first in the world to earn it." : ""}`
      : undefined,
    fields: [
      ...(shown
        ? [
            {
              name: shown.earned ? "Earned by" : "Unlocks at",
              value: shown.needs
                .map((n) => `${n.what}: ${num(n.have)} of ${num(n.at)} done`)
                .join("\n"),
              inline: false,
            },
          ]
        : []),
      ...(c.prey?.today
        ? [
            {
              name: "Prey marked today",
              value: `${capitalise(c.prey.today)}: named once a day, until the day turns.`,
              inline: false,
            },
          ]
        : []),
    ],
    table: tree.length ? { header: ["Tier", "One or the other", "Opens"], rows: tree } : undefined,
    footer: `At most ${plural(c.most, "class", "classes")} are active, chosen at a settlement; abilities taken are kept.`,
    rows,
    colour: COLOUR.signal,
  };
}
