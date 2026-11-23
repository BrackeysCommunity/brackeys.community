import {
  checkCited,
  factsBlock,
  namesBlock,
  properNames,
  systemPrompt,
  type CitedSentence,
  type PromptFact,
  type UseId,
  type UseSpec,
} from "../src/index.ts";

export interface ToyIn {
  facts: PromptFact[];
  names: Record<string, string>;
}

/** A cited-prose use shaped like the chronicle, under any use id. */
export function toyUse(use: UseId = "chronicle"): UseSpec<ToyIn, CitedSentence[]> {
  return {
    use,
    version: 1,
    input: (i) => ({
      facts: i.facts.map((f) => ({ id: f.id, kind: f.kind, line: f.line, here: f.here })),
      names: i.names,
    }),
    prompt: (i) => ({
      system: systemPrompt(
        use,
        "Return the passage as sentences, each with the fact numbers it tells.",
      ),
      user: `${factsBlock(i.facts)}\n\n${namesBlock(i.names)}`,
    }),
    schema: {
      type: "object",
      properties: {
        sentences: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              facts: { type: "array", items: { type: "integer" } },
            },
            required: ["text", "facts"],
            additionalProperties: false,
          },
        },
      },
      required: ["sentences"],
      additionalProperties: false,
    },
    check: (i, reply) =>
      checkCited(
        (reply as { sentences?: unknown } | null)?.sentences,
        i.facts.length,
        {
          names: [...Object.values(i.names), ...properNames(i.facts.map((f) => f.line))],
          maxChars: 900,
        },
        6,
      ),
    stub: (i) => ({ sentences: i.facts.map((f) => ({ text: f.line, facts: [f.n] })) }),
  };
}

/** A day's facts; a lowercase `tag` word makes inputs distinct. */
export function toyInput(tag = ""): ToyIn {
  return {
    facts: [
      {
        n: 1,
        id: 11,
        kind: "arc.stage-ended",
        line: "The wall at Rustmarket held against the raiders.",
        here: true,
      },
      {
        n: 2,
        id: 12,
        kind: "trouble.held",
        line: `The Salt Eaters kept the road open${tag ? ` ${tag}` : ""}.`,
      },
    ],
    names: { "settlement:1": "Rustmarket", "faction:2": "The Salt Eaters" },
  };
}
