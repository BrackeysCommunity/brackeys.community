import type * as api from "../../../mmo-api/src/index.ts";
import { systemPrompt, untrusted } from "../prompt.ts";
import type { CheckReason, CheckResult, JsonSchema, UseSpec } from "../types.ts";

/** Candidate rows a season's proposal holds at most (GDD 12.9). */
export const PROPOSALS_MOST = 3;

export interface ProposalsIn {
  kit: api.ArcKit;
  /** The templated season ledger: what the season cast, how it ended, what the chronicle told. */
  ledger: string;
  season: number;
}

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

type Node = Record<string, unknown>;
const isObject = (v: unknown): v is Node =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The first place a value breaks a sheet schema, or null. It reads the
 * keywords harness schemas are written with; any other keyword is ignored.
 */
export function schemaProblem(v: unknown, s: unknown, at = "row"): string | null {
  if (!isObject(s)) return null;
  if ("const" in s && v !== s.const) return `${at} is not ${JSON.stringify(s.const)}`;
  if (Array.isArray(s.enum) && !s.enum.includes(v))
    return `${at} is not one of ${s.enum.join(", ")}`;
  switch (s.type) {
    case "object": {
      if (!isObject(v)) return `${at} is not an object`;
      const props = isObject(s.properties) ? s.properties : {};
      for (const k of Array.isArray(s.required) ? (s.required as string[]) : []) {
        if (!(k in v)) return `${at} has no ${k}`;
      }
      for (const [k, x] of Object.entries(v)) {
        if (!(k in props)) {
          if (s.additionalProperties === false) return `${at} has an unknown field ${k}`;
          continue;
        }
        const p = schemaProblem(x, props[k], `${at}.${k}`);
        if (p) return p;
      }
      return null;
    }
    case "array": {
      if (!Array.isArray(v)) return `${at} is not a list`;
      for (const [i, x] of v.entries()) {
        const p = schemaProblem(x, s.items, `${at}[${i}]`);
        if (p) return p;
      }
      return null;
    }
    case "string":
      if (typeof v !== "string") return `${at} is not text`;
      if (typeof s.pattern === "string" && !new RegExp(s.pattern, "u").test(v)) {
        return `${at} ${JSON.stringify(v)} does not match ${s.pattern}`;
      }
      return null;
    case "integer":
    case "number":
      if (typeof v !== "number" || (s.type === "integer" && !Number.isInteger(v))) {
        return `${at} is not a${s.type === "integer" ? " whole" : ""} number`;
      }
      if (typeof s.minimum === "number" && v < s.minimum) return `${at} is below ${s.minimum}`;
      if (typeof s.maximum === "number" && v > s.maximum) return `${at} is above ${s.maximum}`;
      return null;
    case "boolean":
      return typeof v === "boolean" ? null : `${at} is not true or false`;
    default:
      return null;
  }
}

/** The story.arcs row schema the kit carries, or null when it does not parse. */
export function arcRowSchema(kit: api.ArcKit): JsonSchema | null {
  try {
    const s = JSON.parse(kit.schema) as unknown;
    const rows = isObject(s) && isObject(s.properties) ? s.properties.rows : undefined;
    return isObject(rows) && isObject(rows.items) ? rows.items : null;
  } catch {
    return null;
  }
}

/** Every effect a row names: each side's win and each stage's lapse. */
export function rowEffects(row: unknown): string[] {
  const out: string[] = [];
  const stages = isObject(row) && Array.isArray(row.stages) ? row.stages : [];
  for (const st of stages) {
    if (!isObject(st)) continue;
    for (const side of Array.isArray(st.sides) ? st.sides : []) {
      if (!isObject(side)) continue;
      for (const e of Array.isArray(side.won) ? side.won : []) {
        if (isObject(e) && typeof e.kind === "string") out.push(e.kind);
      }
    }
    for (const e of Array.isArray(st.lapse) ? st.lapse : []) {
      if (isObject(e) && typeof e.kind === "string") out.push(e.kind);
    }
  }
  return out;
}

const fail = (reason: CheckReason, detail: string): CheckResult<unknown[]> => ({
  ok: false,
  reason,
  detail,
});

/**
 * The candidate rows, or the first reason they may not be written: the
 * kit's own row schema, an id the kit does not already hold, and a when
 * and effects the kit registers. The harness's proposals run is the
 * authority that compiles them against the book.
 */
export function checkProposals(i: ProposalsIn, reply: unknown): CheckResult<unknown[]> {
  const rows = isObject(reply) ? reply.rows : undefined;
  if (!Array.isArray(rows)) return fail("schema", "no list of rows");
  if (rows.length === 0) return fail("empty", "no rows");
  if (rows.length > PROPOSALS_MOST) {
    return fail("bad-count", `${rows.length} rows, at most ${PROPOSALS_MOST}`);
  }
  const schema = arcRowSchema(i.kit);
  if (!schema) return fail("schema", "the kit's schema does not parse");
  const taken = new Set(i.kit.templates);
  const when = new Set(i.kit.when);
  const effects = new Set(i.kit.effects);
  for (const [n, row] of rows.entries()) {
    const at = `row ${n + 1}`;
    const p = schemaProblem(row, schema, at);
    if (p) return fail("schema", p);
    const r = row as { id: string; when: string };
    if (!ID.test(r.id)) return fail("bad-id", `${at}: id ${JSON.stringify(r.id)}`);
    if (taken.has(r.id)) return fail("bad-id", `${at}: ${r.id} is already a template`);
    taken.add(r.id);
    if (!when.has(r.when)) return fail("bad-id", `${at}: when ${r.when} is not registered`);
    for (const k of rowEffects(row)) {
      if (!effects.has(k)) return fail("bad-id", `${at}: effect ${k} is not a story effect`);
    }
  }
  return { ok: true, value: rows };
}

const pick = (list: readonly string[], ...prefer: string[]) =>
  prefer.find((p) => list.includes(p)) ?? list[0] ?? "";

/** An id the kit does not hold yet, from a stem. */
function freshId(stem: string, taken: readonly string[]): string {
  let id = stem;
  for (let n = 2; taken.includes(id); n++) id = `${stem}-${n}`;
  return id;
}

/**
 * A region arc shaped like the authored ones, built from the kit alone:
 * the stub's reply, which the check and the harness both accept.
 */
function stubRow(i: ProposalsIn): Record<string, unknown> {
  const { kit } = i;
  const nothing = pick(kit.effects, "nothing");
  return {
    id: freshId(`proposed-season-${i.season}`, kit.templates),
    scope: "region",
    when: pick(kit.when, "dry-region"),
    chance: 30,
    cast: [
      { role: "front", kind: "region", pick: "given" },
      { role: "seat", kind: "settlement", pick: "nearest" },
    ],
    stages: [
      {
        id: "the-holdout",
        days: 3,
        sides: [
          {
            id: "supply-the-seat",
            wants: "goods",
            tag: "provisions",
            per: 25,
            at: "seat",
            won: [{ kind: nothing }],
          },
          { id: "clear-the-front", wants: "beats", per: 25, at: "front", won: [{ kind: nothing }] },
        ],
        lapse: [{ kind: nothing }],
      },
    ],
    note: "Proposed by the stub from the arc kit alone.",
  };
}

const EFFECT = {
  type: "object",
  properties: {
    kind: { type: "string" },
    role: { type: "string" },
    gauge: { type: "string" },
    amount: { type: "integer" },
    ref: { type: "string" },
  },
  required: ["kind"],
  additionalProperties: false,
};

/** The reply's shape; the kit's own row schema holds the enums and ranges the check reads. */
const SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          scope: { type: "string" },
          when: { type: "string" },
          finale: { type: "boolean" },
          chance: { type: "integer" },
          cast: {
            type: "array",
            items: {
              type: "object",
              properties: {
                role: { type: "string" },
                kind: { type: "string" },
                pick: { type: "string" },
              },
              required: ["role", "kind", "pick"],
              additionalProperties: false,
            },
          },
          stages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                days: { type: "integer" },
                sides: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      wants: { type: "string" },
                      tag: { type: "string" },
                      per: { type: "integer" },
                      at: { type: "string" },
                      sponsor: { type: "string" },
                      opponent: { type: "string" },
                      won: { type: "array", items: EFFECT },
                    },
                    required: ["id", "wants", "per", "at", "won"],
                    additionalProperties: false,
                  },
                },
                lapse: { type: "array", items: EFFECT },
              },
              required: ["id", "sides", "lapse"],
              additionalProperties: false,
            },
          },
          note: { type: "string" },
        },
        required: ["id", "scope", "when", "chance", "cast", "stages", "note"],
        additionalProperties: false,
      },
    },
  },
  required: ["rows"],
  additionalProperties: false,
};

const RULES = `Propose new arc templates for the next season, as story.arcs rows a designer reviews and approves by hand. Read the season's ledger for what the story did: templates that were never cast, arcs that lapsed or ended one-sided, places and factions the story left alone.
- Return at most ${PROPOSALS_MOST} rows, each a new template; fewer good rows beat more weak ones.
- Every row follows the schema in the schema block exactly. Its id is new: no listed template has it.
- "when" is one of the registered predicates, spelled exactly. Every effect kind is one of the listed effects.
- Shape rows like the authored templates of the same scope: a region or personal arc has one stage with days; a world arc's stages carry no days; each stage has at least two sides, and every side's win and every lapse does something.
- Roles named by sides and effects are roles of the row's own cast.
- Put in each row's note what it answers in the ledger and which numbers are provisional.`;

/** Arc proposals between seasons (GDD 12.9): rows for a person to approve, never code. */
export const proposalsUse: UseSpec<ProposalsIn, unknown[]> = {
  use: "proposals",
  version: 1,
  input: (i) => ({
    kit: {
      season: i.kit.season,
      templates: i.kit.templates,
      when: i.kit.when,
      effects: i.kit.effects,
      schema: i.kit.schema,
    },
    ledger: i.ledger,
    season: i.season,
  }),
  prompt: (i) => ({
    system: systemPrompt("proposals", RULES),
    user: [
      `Season ${i.season} has closed. Propose templates for the season after it.`,
      untrusted(
        "kit",
        [
          `templates: ${i.kit.templates.join(", ")}`,
          `when: ${i.kit.when.join(", ")}`,
          `effects: ${i.kit.effects.join(", ")}`,
        ].join("\n"),
      ),
      untrusted("schema", i.kit.schema),
      untrusted("ledger", i.ledger),
    ].join("\n\n"),
  }),
  schema: SCHEMA,
  check: checkProposals,
  stub: (i) => ({ rows: [stubRow(i)] }),
};
