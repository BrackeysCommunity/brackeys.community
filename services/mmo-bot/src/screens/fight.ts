import {
  type Button,
  buttonRows,
  type EmbedField,
} from "../../../../packages/discord-kit/src/index.ts";
import {
  encounterLine,
  WASTELAND_ENCOUNTERS,
} from "../../../../packages/mmo-words/src/encounters.ts";
import { riskLine } from "../../../../packages/mmo-words/src/index.ts";
import * as api from "../api.ts";
import { type Card, COLOUR } from "../card.ts";
import { target } from "../ids.ts";
import type { Lexicon } from "../lexicon.ts";
import { amount, band, bandShort, num, signed, ticks } from "../units.ts";
import { back, banner, btn, DIRECTIONS, downButtons, factNum, launch, PRIVATE } from "./common.ts";
import { dungeonName, floorOf, floorWord } from "./dungeon.ts";
import { adaptedLine, adaptedSteps } from "./emergence.ts";

/** The creature a fight is against: a region's variant by its own name (GDD 4.17). */
export function creatureName(
  f: Pick<api.Fight, "creature" | "creatureName">,
  lex: Lexicon,
): string {
  return f.creatureName || lex.name("creatures.archetypes", f.creature);
}

/** The beat's opening line from the setting's encounter pool, stable for the fight and the beat; "" when none. */
export function poolLine(f: api.Fight, place: string, lex: Lexicon): string {
  return encounterLine(WASTELAND_ENCOUNTERS, f, { creature: creatureName(f, lex), place });
}

/** The description with the pool line first. */
export function withPoolLine(line: string, rest: string): string {
  return line ? `${line}\n\n${rest}` : rest;
}

/** What adaptation took off an option, after its risk; "" when nothing. */
export function adaptedTail(x: api.Option): string {
  const steps = adaptedSteps(x.why);
  return steps ? `; ${adaptedLine(steps)}` : "";
}

/** A why part in words: the land, a road, an adaptation, as each is read. */
function partLine(p: api.Part, value: string): string {
  if (p.label === api.WhyAdapted) return adaptedLine(p.value);
  if (p.label === api.WhyRoad) return `on the road ${value}`;
  return `${p.label} ${value}`;
}

/** A beat: the situation, every option with its band and risk, edited in place from beat to beat (GDD 7.1). */
export function beatCard(
  o: api.Options,
  here: api.Here,
  lex: Lexicon,
  last?: { pressed: api.Pressed[]; facts: api.Fact[] },
): Card {
  const f = o.fight!;
  const v = o.version;
  const creature = creatureName(f, lex);
  const beat = lex.name("fights.beats", f.kind);
  const opts = f.options.filter((x) => !x.puzzle);
  const machines = f.options.filter((x) => x.puzzle);
  const buttons: Button[] = opts.map((x) =>
    btn(`${lex.name("fights.options", x.id)} · ${bandShort(x.band)}`, "press", x.id, v, {
      style: x.kind === "win" ? "primary" : x.kind === "way-out" ? "secondary" : "success",
    }),
  );
  // A machine is worked by hand in the Activity: its option is never a button here (GDD 7.11).
  const family = f.machine ? lex.name("puzzles.families", f.machine) : "";
  const lines = [
    ...machines.map(
      (m) =>
        `**${lex.name("fights.options", m.id)}**: ${family ? `the ${family}, a machine` : "a machine"} worked in the Activity (${band(m.band)})`,
    ),
    ...opts.map(
      (x) =>
        `**${lex.name("fights.options", x.id)}**: ${band(x.band)}, ${riskLine(x)}${adaptedTail(x)}`,
    ),
  ];
  if (f.machine) buttons.unshift(launch(`Work the machine: ${family}`, "beat", v));
  let opening = "";
  if (last?.pressed.length) {
    const p = last.pressed[0]!;
    opening = `${lex.name("fights.options", p.option)} at ${band(p.band).toLowerCase()}: **${p.success ? "it worked" : "it failed"}**.\n\n`;
  }
  const fields: EmbedField[] = [
    { name: "Beat", value: `beat ${f.beat + 1} of ${amount(f.beats, "beats")}`, inline: true },
    { name: "Against", value: creature, inline: true },
    { name: "Where", value: here.name, inline: true },
  ];
  if (f.variant)
    fields.push({
      name: "A variant",
      value: `Of the ${lex.name("creatures.archetypes", f.creature).toLowerCase()}, ${lex.name("creatures.variants", f.variant).toLowerCase()}: this region's creatures adapted against how most win here`,
    });
  if (f.ambush) {
    fields.push({
      name: "If you stay away",
      value: `it takes ${lex.name("fights.options", f.default ?? "back-out").toLowerCase()} at tick ${num(f.due ?? 0)}`,
    });
  }
  return {
    context: PRIVATE,
    author: f.ambush
      ? "Ambush on the road"
      : here.dungeon || f.floor
        ? `Down in the den · ${floorOf(f.floor || 1, here.floor?.up)}`
        : `Encounter · ${beat}`,
    title: `${beat}: ${creature}`,
    description: withPoolLine(poolLine(f, here.name, lex), `${opening}${lines.join("\n")}`),
    picture: banner(here, `; ${creature} in a ${beat.toLowerCase()}`),
    fields,
    footer: "The last beat is the hardest and must be won. Two failures and you go down.",
    rows: [
      ...buttonRows(buttons.slice(0, 10)),
      { buttons: [btn("Why these odds", "why", "options", v), back(v)] },
    ],
    colour: f.ambush ? COLOUR.hazard : COLOUR.rust,
    modifiers: true,
    failable: opts.filter((x) => x.band !== "certain").map((x) => lex.name("fights.options", x.id)),
  };
}

/** The beat resolved: the encounter's end, from the press's facts. */
export function resolvedCard(
  o: api.Options,
  here: api.Here,
  lex: Lexicon,
  pressed: api.Pressed[],
  facts: api.Fact[],
): Card {
  const v = o.version;
  const end = facts.find((f) => f.kind.startsWith("encounter."));
  const result = end?.kind.slice("encounter.".length) ?? "over";
  const haul = end ? factNum(end, "haul") : 0;
  const p = pressed[0];
  const titles: Record<string, string> = {
    won: "You won",
    lost: "You went down",
    left: "You backed out",
    held: "You held",
    escaped: "It got away",
  };
  const fields = [
    {
      name: "Haul carried out",
      value: amount(result === "lost" ? 0 : haul, "goods"),
      inline: true,
    },
  ];
  const levelled = facts.filter((f) => f.kind === "item.levelled");
  if (levelled.length)
    fields.push({
      name: "Levels",
      value: levelled.map((f) => `level ${factNum(f, "to")}`).join(", "),
      inline: true,
    });
  const buttons: Button[] = [];
  if (o.conditions.includes(api.CondDown)) buttons.push(...downButtons(o, v));
  else if (o.explore) buttons.push(btn("Explore again", "explore", "", v, { style: "primary" }));
  buttons.push(btn("Where I am", "where", "", v), back(v));
  return {
    context: PRIVATE,
    author: "Encounter · the beat resolved",
    title: titles[result] ?? "It is over",
    description: p
      ? `${lex.name("fights.options", p.option)} at ${band(p.band).toLowerCase()}: ${p.success ? "it worked" : "it failed"}.`
      : undefined,
    picture: banner(here),
    fields,
    footer:
      result === "lost"
        ? `Danger never takes what you wear. Crawling out takes ${ticks(lex.numbers.crawlTicks)} and leaves you wounded.`
        : "The tile remembers who fought here.",
    rows: [{ buttons }],
    colour: result === "won" ? COLOUR.signal : COLOUR.rust,
  };
}

/** Down: what it costs and the way out (GDD 5.5), naming the floor when it is in a dungeon (GDD 4.9). */
export function downCard(o: api.Options, here: api.Here, lex: Lexicon): Card {
  const v = o.version;
  const n = lex.numbers;
  const r = o.rescue;
  const f = here.floor?.floor ? here.floor : undefined;
  const where = f ? `${floorOf(f.floor, f.up)} of ${dungeonName(f, lex)}` : here.name;
  const crawl = f
    ? `Crawling out takes ${ticks(n.crawlTicks)}, longer for each ${floorWord(f.up)} above you`
    : `Crawling out takes ${ticks(n.crawlTicks)}`;
  return {
    context: PRIVATE,
    author: f ? `Down in the den · ${floorOf(f.floor, f.up)}` : "Down",
    title: f ? `Down on ${where}` : `Down at ${here.name}`,
    description: r?.carriedBy
      ? `${r.carriedBy} is carrying you home to ${r.home}. You are set down there, no longer down; crawling out leaves them.`
      : `You cannot act. ${crawl}, runs while you are away, and leaves you wounded: odds one band worse and long actions ${ticks(n.woundedTicks)} longer, for a day or until you rest.`,
    picture: banner(here),
    fields: r?.called
      ? [
          {
            name: "Help",
            value: f
              ? `Called: a Carry goal naming ${floorOf(f.floor, f.up)} is on the board at ${r.home}. A rescuer must reach this ${floorWord(f.up)} to carry you up.`
              : `Called: a Carry goal is on the board at ${r.home}`,
          },
        ]
      : undefined,
    footer:
      "Calling for help posts a Carry goal at your home settlement and starts the crawl; whoever reaches you first carries you in.",
    rows: [
      {
        buttons: [...downButtons(o, v), back(v)],
      },
    ],
    colour: COLOUR.rust,
  };
}

/** The why view: the parts and rules behind a modifier, each in its unit (GDD 8.4). */
export function whyCard(
  o: api.Options,
  here: api.Here,
  lex: Lexicon,
  what: "options" | "moves",
): Card {
  const v = o.version;
  const lines: string[] = [];
  if (what === "options" && o.fight) {
    for (const x of o.fight.options) {
      const parts = x.why.parts.map((p) => partLine(p, signed(p.value, p.unit))).join(", ");
      const rules = x.why.rules?.length
        ? `; rules: ${x.why.rules.map((r) => r.replace(/-/g, " ")).join(", ")}`
        : "";
      const moved =
        x.why.bandFrom && x.why.bandTo && x.why.bandFrom !== x.why.bandTo
          ? `; ${bandShort(x.why.bandFrom)} to ${bandShort(x.why.bandTo)}`
          : "";
      lines.push(
        `**${lex.name("fights.options", x.id)}** (${band(x.band)}): ${parts || "no parts"}${rules}${moved}`,
      );
    }
  } else {
    for (const m of o.moves) {
      const d = DIRECTIONS[m.dir]!;
      if (!m.open) {
        lines.push(`**${d.arrow} ${d.name}**: impassable`);
        continue;
      }
      lines.push(
        `**${d.arrow} ${d.name}**: ${m.why.parts.map((p) => partLine(p, amount(p.value, p.unit))).join(", ")}`,
      );
    }
  }
  return {
    context: PRIVATE,
    author: "Why · the tags and rules behind it",
    title:
      what === "options" ? "Why the odds are what they are" : "Why each way costs what it does",
    description: lines.join("\n") || "Nothing is modifying this.",
    picture: banner(here),
    footer: "Every modifier is a rule over tags you can read in the sheets.",
    rows: [{ buttons: [btn("Back", what === "options" ? "fight" : "travel", "", v), back(v)] }],
  };
}

/** Explore / Gather: the site here, the nodes and what they hold, foraging (GDD 6, 6.4). */
export function fieldCard(o: api.Options, here: api.Here, lex: Lexicon): Card {
  const v = o.version;
  const busy = !!o.long || !!o.fight || o.conditions.includes(api.CondDown);
  const buttons: Button[] = [];
  if (o.explore)
    buttons.push(
      btn(here.dungeon ? "Enter floor 1" : "Explore the site", "explore", "", v, {
        style: "primary",
        disabled: busy,
      }),
    );
  const nodes = here.materials.map(
    (m) =>
      `${lex.material(m.material)}: ${m.workedOut ? "worked out" : `${amount(m.left, lex.material(m.material))} left`}`,
  );
  const gather: Button[] = here.materials
    .filter((m) => !m.workedOut)
    .slice(0, 4)
    .map((m) =>
      btn(
        `Gather ${lex.material(m.material)} · ${amount(1, "tick")}`,
        "gather",
        target(":", m.material, 1),
        v,
        { disabled: busy },
      ),
    );
  const forage = btn(`Forage · ${amount(1, "tick")}`, "forage", "1", v, { disabled: busy });
  return {
    context: PRIVATE,
    author: `Explore / Gather · ${here.name}`,
    title: o.explore ? "There is something to explore here" : "Nothing to explore here",
    description: o.explore
      ? `A site, and something living there. An encounter is ${amount(lex.numbers.beatsMin, "beats")} to ${amount(lex.numbers.beatsMax, "beats")}, with the odds on every option.`
      : "No site with anything living on this tile.",
    picture: banner(here),
    fields: [
      { name: "Nodes", value: nodes.join("\n") || "none" },
      { name: "Foraging", value: `${amount(here.forage, "provisions")} a tick here`, inline: true },
      {
        name: "Gathering",
        value: "goods from the node each tick, wearing your tool",
        inline: true,
      },
    ],
    footer: "A gathering tick at the node's tier levels the tool in your hand.",
    rows: [
      { buttons: [...buttons, forage, back(v)] },
      ...(gather.length ? [{ buttons: gather }] : []),
    ],
  };
}
