import { type Button, type Row } from "../../../../packages/discord-kit/src/index.ts";
import type * as api from "../api.ts";
import { authorLine, type Card, COLOUR } from "../card.ts";
import { encodeId } from "../ids.ts";
import { num, plural } from "../units.ts";
import { back, btn, PRIVATE } from "./common.ts";

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
          .map((x) => ({
            label: x.name,
            value: x.id,
            description: (x.earned ? `level ${x.level}` : "not yet earned").slice(0, 90),
          })),
      },
    },
  ];
  const acts: Button[] = [];
  if (shown?.earned && !shown.active && c.here)
    acts.push(btn(`Make ${shown.name} active`, "cls-choose", shown.id, v, { style: "primary" }));
  if (shown?.active)
    for (const t of shown.tiers)
      if (t.open && !t.options.some((a) => a.taken))
        for (const a of t.options)
          acts.push(btn(`Take: ${a.name}`.slice(0, 80), "cls-take", a.id, v, { style: "success" }));
  acts.push(btn("Character", "character", "", v), back(v));
  rows.push({ buttons: acts.slice(0, 5) });
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
    fields: shown
      ? [
          {
            name: shown.earned ? "Earned by" : "Unlocks at",
            value: shown.needs
              .map((n) => `${n.what}: ${num(n.have)} of ${num(n.at)} done`)
              .join("\n"),
            inline: false,
          },
        ]
      : undefined,
    table: tree.length ? { header: ["Tier", "One or the other", "Opens"], rows: tree } : undefined,
    footer: "Two classes at most are active, chosen at a settlement; abilities taken are kept.",
    rows,
    colour: COLOUR.signal,
  };
}
