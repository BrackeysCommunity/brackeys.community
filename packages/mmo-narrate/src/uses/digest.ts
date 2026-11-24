import { proseProblem } from "../check.ts";
import { properNames, systemPrompt, untrusted } from "../prompt.ts";
import type { CheckResult, JsonSchema, UseSpec } from "../types.ts";

/** Paragraphs above the digest's tables at most. */
export const DIGEST_PARAGRAPHS = 5;
/** The longest paragraph. */
export const DIGEST_PARAGRAPH_CHARS = 600;

export interface DigestIn {
  /** Which week the tables cover, in words the report heads itself with. */
  week: string;
  /** The report's markdown tables, each under its heading. */
  tables: string;
}

/** The headings the tables sit under, without their markdown. */
export const tableHeadings = (tables: string): string[] =>
  tables
    .split("\n")
    .filter((l) => l.startsWith("#"))
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .filter(Boolean);

/** What the paragraphs may name: the proper names the tables and the week show. */
const allowedNames = (i: DigestIn): string[] =>
  properNames([i.week, ...i.tables.split("\n").map((l) => l.replace(/[|#*`_-]+/g, " ").trim())]);

/**
 * Paragraphs that pass the prose rules with no number at all, since every
 * figure is the tables' to give. Any paragraph failing drops them all, and
 * the report is the tables alone.
 */
export function checkDigest(i: DigestIn, reply: unknown): CheckResult<string[]> {
  const paragraphs = (reply as { paragraphs?: unknown } | null)?.paragraphs;
  if (!Array.isArray(paragraphs) || !paragraphs.every((p) => typeof p === "string")) {
    return { ok: false, reason: "schema", detail: "not a list of paragraphs" };
  }
  if (paragraphs.length === 0) return { ok: false, reason: "empty", detail: "no paragraphs" };
  if (paragraphs.length > DIGEST_PARAGRAPHS) {
    return {
      ok: false,
      reason: "bad-count",
      detail: `${paragraphs.length} paragraphs, at most ${DIGEST_PARAGRAPHS}`,
    };
  }
  const rules = { names: allowedNames(i), maxChars: DIGEST_PARAGRAPH_CHARS };
  const out: string[] = [];
  for (const [n, p] of (paragraphs as string[]).entries()) {
    const problem = proseProblem(p, rules);
    if (problem) {
      return { ok: false, reason: problem.reason, detail: `paragraph ${n + 1}: ${problem.detail}` };
    }
    out.push(p.trim());
  }
  return { ok: true, value: out };
}

const SCHEMA: JsonSchema = {
  type: "object",
  properties: { paragraphs: { type: "array", items: { type: "string" } } },
  required: ["paragraphs"],
  additionalProperties: false,
};

const RULES = `Write the paragraphs that open the designer's weekly balance report. The tables follow your paragraphs and give every figure, so say in words what they show: whether coin per active character sits in its band, which goods moved and why, how the faucet compares with what drains coin, whether promotions keep up with their need, and what narration cost. Point the designer at what most needs a look.
- Return at most ${DIGEST_PARAGRAPHS} short paragraphs, each at most ${DIGEST_PARAGRAPH_CHARS} characters.
- Say "above the band", "most", "fell" or "no change" instead of any figure.`;

/** The weekly balance digest's paragraphs (GDD 18): words for the designer above the tables. */
export const digestUse: UseSpec<DigestIn, string[]> = {
  use: "digest",
  version: 1,
  input: (i) => ({ week: i.week, tables: i.tables }),
  prompt: (i) => ({
    system: systemPrompt("digest", RULES),
    user: `${untrusted("week", i.week)}\n\n${untrusted("tables", i.tables)}`,
  }),
  schema: SCHEMA,
  check: checkDigest,
  stub: (i) => {
    const headings = tableHeadings(i.tables).map((h) => h.toLowerCase());
    return {
      paragraphs: [
        headings.length
          ? `The tables below cover ${headings.length > 1 ? `${headings.slice(0, -1).join(", ")} and ${headings.at(-1)}` : headings[0]}.`
          : "The tables below give the week's figures.",
        "Each figure carries its unit, and each band or need sits beside the figure it is read against.",
      ],
    };
  },
};
