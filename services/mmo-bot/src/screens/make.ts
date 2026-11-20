import { type Button, buttonRows, type Row } from "../../../../packages/discord-kit/src/index.ts";
import type * as api from "../api.ts";
import { type Card, COLOUR } from "../card.ts";
import { encodeId, target } from "../ids.ts";
import type { Lexicon } from "../lexicon.ts";
import { amount, outOf, signed } from "../units.ts";
import { back, banner, btn, factNum, held, priceLadder, PRIVATE, stationLine } from "./common.ts";

/** A recipe as the craft card carries it between selects: process.method.slot.material.qty. */
export interface Draft {
  process?: string;
  method?: string;
  slot?: string;
  material?: string;
  qty?: number;
}

const DRAFT_SEP = ".";

export function draftKey(d: Draft): string {
  const parts = [
    d.process ?? "",
    d.method ?? "",
    d.slot ?? "",
    d.material ?? "",
    String(d.qty ?? ""),
  ];
  return target(DRAFT_SEP, ...parts);
}

export function parseDraft(s: string): Draft {
  const [process, method, slot, material, qty] = s.split(DRAFT_SEP);
  return {
    process: process || undefined,
    method: method || undefined,
    slot: slot || undefined,
    material: material || undefined,
    qty: qty ? Number(qty) : undefined,
  };
}

export function draftRecipe(d: Draft): api.Recipe {
  return {
    process: d.process!,
    method: d.method!,
    slot: d.slot,
    inputs: [{ material: d.material!, units: d.qty! }],
  };
}

/** Craft: stations here, and a recipe built by selects, one choice at a time (GDD 9.10). */
export function craftCard(
  o: api.Options,
  here: api.Here,
  sheet: api.Sheet,
  recipes: api.Recipes,
  lex: Lexicon,
  d: Draft,
): Card {
  const v = o.version;
  const rows: Card["rows"] = [];
  const kinds = new Set(here.stations.map((s) => s.kind));
  const can = recipes.processes.filter((p) => p.stations.some((s) => kinds.has(s)));
  const key = draftKey(d);
  let unavailable = "";
  if (!can.length) {
    unavailable = "No station here can work a recipe.";
  } else if (!d.process) {
    rows.push({
      select: {
        customId: encodeId("craft-p", key, v),
        placeholder: "Choose a process",
        options: can.map((p) => ({
          label: lex.name("items.processes", p.id),
          value: p.id,
          description: `at the ${p.stations.join(" or ")}`,
        })),
      },
    });
  } else if (!d.method) {
    const p = recipes.processes.find((x) => x.id === d.process)!;
    rows.push({
      select: {
        customId: encodeId("craft-m", key, v),
        placeholder: "Choose a method",
        options: p.methods.map((m) => ({ label: lex.name("items.methods", m), value: m })),
      },
    });
  } else if (!d.slot && recipes.processes.find((x) => x.id === d.process)?.needsSlot) {
    rows.push({
      select: {
        customId: encodeId("craft-s", key, v),
        placeholder: "Choose what to make",
        options: recipes.slots.map((s) => ({ label: lex.name("items.slots", s), value: s })),
      },
    });
  } else if (!d.material) {
    const goods = sheet.character.goods.filter((g) => g.units > 0);
    if (!goods.length) unavailable = "You carry no materials.";
    else
      rows.push({
        select: {
          customId: encodeId("craft-i", key, v),
          placeholder: "Choose the material",
          options: goods.map((g) => ({
            label: amount(g.units, lex.material(g.material)),
            value: g.material,
          })),
        },
      });
  } else if (!d.qty) {
    const have = held(sheet.character.goods, d.material);
    rows.push({
      buttons: [1, 2, 3]
        .filter((q) => q <= have)
        .map((q) =>
          btn(`${amount(q, lex.material(d.material!))}`, "craft-q", draftKey({ ...d, qty: q }), v),
        ),
    });
  }
  rows.push({ buttons: [...(key !== "...." ? [btn("Start over", "craft", "", v)] : []), back(v)] });
  const chosen = [
    d.process && `Process: ${lex.name("items.processes", d.process)}`,
    d.method && `Method: ${lex.name("items.methods", d.method)}`,
    d.slot && `Makes: ${lex.name("items.slots", d.slot)}`,
    d.material && `Material: ${lex.material(d.material)}`,
  ].filter(Boolean);
  return {
    context: PRIVATE,
    author: `Craft · ${here.name}`,
    title: here.stations.length ? "At the stations" : "No stations here",
    description: here.stations.length
      ? `${[...chosen, unavailable].filter(Boolean).join("\n") || "Build a recipe one choice at a time. Before you commit, appraisal shows a range for each axis."}`
      : "Crafting needs a station: a settlement's forge, bench or still.",
    picture: banner(here),
    fields: here.stations.length
      ? [{ name: "Stations", value: here.stations.map((s) => stationLine(s, lex)).join("\n") }]
      : [],
    footer: "A station charges its fee per craft; the quirk is never shown before.",
    rows,
  };
}

/** Appraisal: a range for each axis, before committing (GDD 9.10). */
export function appraisalCard(
  o: api.Options,
  here: api.Here,
  ap: api.Appraisal,
  lex: Lexicon,
  d: Draft,
): Card {
  const v = o.version;
  return {
    context: PRIVATE,
    author: ap.known ? "Shaping · a known kind" : "Shaping with appraisal",
    title: ap.name,
    description: ap.known
      ? "You know this kind: the values are exact."
      : "Each axis lies inside its range; practice narrows it.",
    picture: banner(here),
    table: {
      header: ["Axis", "Low (pts)", "High (pts)"],
      rows: ap.axes.map((a) => [a.axis, String(a.lo), String(a.hi)]),
    },
    fields: [
      { name: "Tier", value: `tier ${ap.tier}`, inline: true },
      {
        name: "Station",
        value: stationLine(ap.station, lex),
        inline: true,
      },
      {
        name: "Takes",
        value: ap.inputs.map((i) => amount(i.units, lex.material(i.material))).join(", "),
        inline: true,
      },
      ...(ap.registered === undefined
        ? []
        : [
            {
              name: "Master's eye",
              value: ap.registered
                ? "Registered: making it discovers nothing."
                : "Not registered: nobody has made this kind yet.",
              inline: false,
            },
          ]),
    ],
    footer:
      "Committing spends the inputs and the fee; a craft at the station's tier gives your tool xp.",
    rows: [
      {
        buttons: [
          btn("Commit", "craft-go", draftKey(d), v, { style: "success" }),
          btn("Start over", "craft", "", v),
          back(v),
        ],
      },
    ],
  };
}

/** A craft made: the item, and a first discovery with its plain name. */
export function madeCard(o: api.Options, here: api.Here, facts: api.Fact[], lex: Lexicon): Card {
  const v = o.version;
  const discovered = facts.some((f) => f.kind === "kind.discovered");
  const failed = facts.some((f) => f.kind === "craft.failed");
  const levelled = facts.filter((f) => f.kind === "item.levelled");
  return {
    context: PRIVATE,
    author: discovered ? "First discovery and naming" : "Craft · made",
    title: failed ? "It made nothing useful" : discovered ? "Nobody has made this before" : "Made",
    description: failed
      ? "The inputs came apart into salvage, and the attempt is recorded."
      : discovered
        ? "You are its first maker, and the record says so. It takes its plain name for now; naming your own comes later."
        : "It is in your pack.",
    picture: banner(here),
    fields: levelled.map((f) => ({
      name: "Your tool",
      value: `level ${factNum(f, "to")}`,
      inline: true,
    })),
    footer: "Equip it from your character.",
    rows: [
      {
        buttons: [
          btn("Character", "character", "", v),
          btn("Craft again", "craft", "", v),
          back(v),
        ],
      },
    ],
    colour: discovered ? COLOUR.hazard : COLOUR.ash,
  };
}

/** /character: kit, pack, practice, standing and record (GDD 5.7). */
export function characterCard(
  o: api.Options,
  here: api.Here,
  sheet: api.Sheet,
  lex: Lexicon,
): Card {
  const v = o.version;
  const item = (i: api.Item) =>
    `${i.name || lex.name("mounts.kinds", i.mount ?? "")}: level ${i.level}, ${outOf(i.durability, i.max, "durability")}${i.offers?.length ? " · a milestone pick waits" : ""}`;
  const all = [...sheet.kit, ...sheet.pack];
  const fields = [
    {
      name: "Kit",
      value: sheet.kit.map((i) => `${i.worn}: ${item(i)}`).join("\n") || "nothing worn",
    },
    { name: "Pack", value: sheet.pack.map(item).join("\n") || "empty" },
    {
      name: "Practice",
      value:
        sheet.character.practice.map((p) => `${p.id} level ${p.level}`).join(", ") || "none yet",
      inline: true,
    },
    {
      name: "Standing",
      value:
        sheet.standing.map((s) => `${signed(s.value, "standing")} with ${s.with}`).join("\n") ||
        "none yet",
      inline: true,
    },
    {
      name: "Record",
      value:
        sheet.record
          .slice(0, 8)
          .map((r) => `${r.key.replace(/:/g, " ")}: ${amount(r.n, r.unit)}`)
          .join("\n") || "nothing yet",
      inline: true,
    },
  ];
  if (sheet.vows.length)
    fields.push({ name: "Vows kept so far", value: sheet.vows.map((v) => `• ${v}`).join("\n") });
  if (sheet.finds.length)
    fields.push({
      name: "Finds",
      value: sheet.finds
        .slice(-3)
        .map((f) => `${f.rarity} (${f.chance}% of finds), ${lex.name("tiles.triggers", f.trigger)}`)
        .join("\n"),
    });
  const sigil = sheet.kit.find((i) => i.sigil)?.sigil;
  return {
    context: PRIVATE,
    author: "Character · kit, practice, standing",
    title: `${sheet.start ? `Carrying a ${sheet.start} from the gate` : "Your character"}`,
    picture: sigil ? { media: sigil, alt: "The sigil of what you carry in hand" } : banner(here),
    fields,
    footer: all.length ? "Open an item for its card: level, picks, repair." : "You carry no items.",
    rows: [
      ...(all.length
        ? [
            {
              select: {
                customId: encodeId("item", "", v),
                placeholder: "Open an item…",
                options: all.slice(0, 25).map((i) => ({
                  label: i.name || i.id,
                  value: i.id,
                  description: i.worn ? `worn: ${i.worn}` : "in the pack",
                })),
              },
            },
          ]
        : []),
      { buttons: [btn("Recipes", "recipes", "", v), btn("Classes", "classes", "", v), back(v)] },
    ],
  };
}

/**
 * An item's card: its sigil, axes, level, durability, and what it can
 * take (GDD 9.11, 9.12, 16.3). deckHeld says a deck is in the off-hand
 * for an exploit to load into.
 */
export function itemCard(
  o: api.Options,
  here: api.Here,
  it: api.Item,
  lex: Lexicon,
  deckHeld = false,
): Card {
  const v = o.version;
  const atStation = here.stations.length > 0;
  const buttons: Button[] = [];
  if (!it.worn)
    for (const w of (it.wearIn ?? []).slice(0, 2))
      buttons.push(btn(`Wear in ${w}`, "equip", target(":", it.id, w), v));
  if (!it.worn && it.loads && deckHeld)
    buttons.push(btn("Load into your deck", "equip", target(":", it.id, "deck"), v));
  if (it.durability < it.max || it.dormant)
    buttons.push(btn("Repair", "repair", it.id, v, { disabled: !atStation }));
  const picks: Button[] = (it.offers ?? []).map((off) =>
    btn(`Pick: ${lex.name("items.traits", off)}`, "pick", target(":", it.id, off), v, {
      style: "success",
      disabled: !atStation,
    }),
  );
  const trade: Row[] = [];
  if (o.purse.market && !it.worn && !it.mount) {
    trade.push({
      select: {
        customId: encodeId("list", it.id, v),
        placeholder: "List it for sale at…",
        options: priceLadder(it.value, [80, 100, 120, 150, 200]).map(({ pct, price }) => ({
          label: amount(price, "coin"),
          value: String(price),
          description: `${pct}% of its worth`,
        })),
      },
    });
    trade.push({
      buttons: [
        btn(`Sell to the trader · ${amount(it.traderPays, "coin")}`, "sell-item", it.id, v),
      ],
    });
  }
  return {
    context: PRIVATE,
    author: `Item card · ${it.worn ? `worn in ${it.worn}` : "in the pack"}`,
    title: it.name || it.id,
    description: it.dormant
      ? "Dormant: unusable until repaired, never destroyed."
      : it.offers?.length
        ? "It has reached a milestone: take one of two picks at a station, for materials and the station fee."
        : undefined,
    picture: it.sigil
      ? {
          media: it.sigil,
          alt: `Sigil of ${it.name}: its outline, slot, strongest axes, ${amount(1 + Math.floor(it.level / 5), "notches")} for its level and a dot per pick`,
        }
      : banner(here),
    fields: [
      { name: "Level", value: `level ${it.level}, ${outOf(it.xp, it.toNext, "xp")}`, inline: true },
      { name: "Durability", value: outOf(it.durability, it.max, "durability"), inline: true },
      { name: "Tier", value: `tier ${it.tier}`, inline: true },
      {
        name: "Axes",
        value: it.axes.map((a) => amount(a.value, `pts ${a.label}`)).join(", ") || "none",
      },
      {
        name: "Traits",
        value: it.traits.map((t) => lex.name("items.traits", t)).join(", ") || "none",
        inline: true,
      },
      {
        name: "Picks",
        value: it.picks.map((t) => lex.name("items.traits", t)).join(", ") || "none yet",
        inline: true,
      },
      { name: "Worth", value: amount(it.value, "coin"), inline: true },
    ],
    footer: atStation
      ? "Repair costs a coin a point and units of its top material."
      : "Repairs and picks are made at a station.",
    rows: [
      ...(picks.length ? [{ buttons: picks }] : []),
      ...trade,
      { buttons: [...buttons.slice(0, 3), btn("Character", "character", "", v), back(v)] },
    ],
  };
}

/** /recipes: the kinds you know (GDD 17.1). */
export function recipesCard(o: api.Options, here: api.Here, r: api.Recipes, lex: Lexicon): Card {
  return {
    context: PRIVATE,
    author: "Recipes · known kinds",
    title: r.known.length ? "What you know how to make" : "You know no recipes yet",
    description: r.known.length
      ? undefined
      : "Craft something and it is here: the first maker of a kind is recorded.",
    picture: banner(here),
    table: r.known.length
      ? {
          header: ["Kind", "Process", "Inputs (goods)"],
          rows: r.known
            .slice(0, 15)
            .map((k) => [
              k.name,
              lex.name("items.processes", k.recipe.process),
              k.recipe.inputs.map((i) => `${i.units} ${lex.material(i.material)}`).join(", "),
            ]),
        }
      : undefined,
    footer: "Patterns, written-out recipes, trade like items in a later build.",
    rows: [{ buttons: [btn("Craft", "craft", "", o.version), back(o.version)] }],
  };
}
