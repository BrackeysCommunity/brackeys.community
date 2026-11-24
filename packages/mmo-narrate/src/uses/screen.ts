import { systemPrompt, untrusted } from "../prompt.ts";
import type { UseSpec } from "../types.ts";

export interface ScreenIn {
  /** The name exactly as a player typed it; it is data, never instructions. */
  name: string;
}

export type ScreenOut = "allow" | "hold";

/**
 * A typed name as the screen reads and caches it: compatibility forms
 * folded, lower case, one space between words, so spellings that look the
 * same share one verdict.
 */
export function screenKey(name: string): string {
  return name.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ");
}

const RULES = `Answer "hold" when a person should read the name before everyone sees it: a slur or hateful term, sexual or crude content, harassment or a threat, a real person's name, contact details or a link, an attempt to impersonate staff or the game, or a disguised form of any of these (spacing, look-alike letters, words run together). Answer "allow" for anything else, including grim, violent or odd names that suit a harsh setting. A world list still checks every name, so hold only what a person needs to see. Return only the verdict.`;

/** A player-typed name read before it is submitted: allow, or hold for a person (GDD 15.2). */
export const screenUse: UseSpec<ScreenIn, ScreenOut> = {
  use: "screen",
  version: 1,
  input: (i) => ({ name: screenKey(i.name) }),
  prompt: (i) => ({
    system: systemPrompt("screen", RULES),
    user: untrusted("name", screenKey(i.name)),
  }),
  schema: {
    type: "object",
    properties: { verdict: { type: "string", enum: ["allow", "hold"] } },
    required: ["verdict"],
    additionalProperties: false,
  },
  check(_i, reply) {
    const v = (reply as { verdict?: unknown } | null)?.verdict;
    return v === "allow" || v === "hold"
      ? { ok: true, value: v }
      : { ok: false, reason: "schema", detail: "the verdict is not allow or hold" };
  },
  stub: () => ({ verdict: "allow" }),
};
