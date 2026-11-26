/** Words a number may be followed by: units, and the connectors of "70 to 64 of 90 durability". */
export const UNITS = new Set([
  "coin",
  "coins",
  "goods",
  "pts",
  "event",
  "durability",
  "xp",
  "level",
  "tier",
  "load",
  "health",
  "defence",
  "threat",
  "scarcity",
  "unrest",
  "corruption",
  "prosperity",
  "standing",
  "alignment",
  "tick",
  "ticks",
  "min",
  "minutes",
  "hour",
  "hours",
  "days",
  "day",
  "tiles",
  "tile",
  "provisions",
  "provision",
  "beats",
  "beat",
  "downs",
  "times",
  "encounters",
  "each",
  "fee",
  "weight",
  "floor",
  "more",
  "people",
  "kinds",
  "ambushes",
  "orders",
  "members",
  "officers",
  "vote",
  "votes",
  "goals",
  "goal",
  "claims",
  "claim",
  "done",
  "pledged",
  "creature",
  "creatures",
  "class",
  "classes",
  "member",
  "settlement",
  "settlements",
  "fact",
  "facts",
  "item",
  "items",
  "s",
  "use",
  "uses",
  "lesson",
  "lessons",
  "pouch",
  "pouches",
  "time",
  "world",
  "wire",
  "wires",
  "here",
  "hint",
  "hints",
  "family",
  "families",
  "character",
  "characters",
  "seat",
  "seats",
  "way",
  "ways",
  "presser",
  "pressers",
  "levels",
  "floors",
  "score",
  "stage",
  "stages",
  "season",
  "seasons",
  "side",
  "sides",
  "backer",
  "backers",
  "tower",
  "towers",
  "guardian",
  "guardians",
  "pylon",
  "pylons",
  "point",
  "points",
  "value",
  "values",
  "clue",
  "clues",
  "crossing",
  "crossings",
  "clearing",
  "clearings",
  "road",
  "roads",
  "route",
  "routes",
  "caravan",
  "caravans",
  "legend",
  "legends",
  "custom",
  "customs",
  "win",
  "wins",
  "attempt",
  "attempts",
  "promotion",
  "promotions",
  "camp",
  "camps",
  "haunt",
  "haunts",
  "style",
  "styles",
  "variant",
  "variants",
  "material",
  "materials",
  "bench",
  "benches",
  "crate",
  "crates",
  "case",
  "cases",
  "report",
  "reports",
  "pin",
  "pins",
  "action",
  "actions",
  "change",
  "changes",
  "%",
]);
const CONNECTORS = new Set(["to", "of", "and", "or", "–", "-", "×", "+"]);
const UNIT_FIRST = new Set([
  "level",
  "tier",
  "floor",
  "fact",
  "case",
  "beat",
  "practice",
  "day",
  "tick",
  "stage",
  "season",
  "value",
]);

/**
 * The numbers in a text that stand without a unit. A number is fine when
 * the next word (past any connectors and further numbers) is a unit or a
 * name the setting gives a good, when the word before it puts the unit
 * first ("level 10"), when it is an identifier ("#41"), a timestamp, or
 * an odds band's "about 1 in 2".
 */
export function bareNumbers(text: string, names: Set<string> = new Set()): string[] {
  const clean = text
    .replace(/<t:\d+:[a-zA-Z]>/g, " ")
    .replace(/about \d+ in \d+/g, " ")
    .replace(/#\d[\d,]*/g, " ")
    .replace(/[*_`()[\]|]/g, " ");
  const tokens = clean.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  const isNum = (t: string) => /^[+−-]?\d[\d,]*(\.\d+)?%?[.,:;]?$/.test(t);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!isNum(t)) continue;
    if (t.replace(/[.,:;]$/, "").endsWith("%")) continue;
    const before = tokens[i - 1]?.toLowerCase().replace(/[.,:;]$/, "");
    if (before && UNIT_FIRST.has(before)) continue;
    let j = i + 1;
    while (j < tokens.length && (CONNECTORS.has(tokens[j]!) || isNum(tokens[j]!))) j++;
    const word = (tokens[j] ?? "").toLowerCase().replace(/[.,:;!?]$/, "");
    const rest = tokens
      .slice(j, j + 3)
      .join(" ")
      .toLowerCase()
      .replace(/[.,:;!?]$/, "");
    if (UNITS.has(word) || [...names].some((n) => rest.startsWith(n))) continue;
    out.push(t);
  }
  return out;
}
