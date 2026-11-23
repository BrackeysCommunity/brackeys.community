import { describe, expect, test } from "vite-plus/test";

import { NUMBER_WORDS, checkCited, proseProblem, type ProseRules } from "../src/index.ts";

const rules: ProseRules = {
  names: ["Rustmarket", "The Salt Eaters", "Order of the Dust"],
  maxChars: 200,
};
const reason = (text: string, r: ProseRules = rules) => proseProblem(text, r)?.reason ?? null;

describe("proseProblem", () => {
  test("clean prose passes", () => {
    expect(reason("The wall at Rustmarket held, and the Salt Eaters kept the road.")).toBeNull();
    expect(reason("Rustmarket's wall held. I saw it fall to the Order of the Dust.")).toBeNull();
    expect(reason("A first storm came, and the last caravan left.")).toBeNull();
    expect(reason('"Dust came." Then the wind turned: Storms followed.')).toBeNull();
  });

  test("empty", () => {
    expect(proseProblem("  \n ", rules)).toEqual({ reason: "empty", detail: "no text" });
  });

  test("too long", () => {
    expect(reason("word ".repeat(41))).toBe("too-long");
    expect(reason("x".repeat(200))).toBeNull();
  });

  test("mentions and invites", () => {
    expect(reason("The road held @everyone.")).toBe("mention");
    expect(reason("The road held for user@host.")).toBe("mention");
    expect(reason("Join at discord.gg/abc.")).toBe("mention");
  });

  test("markup and links", () => {
    for (const c of ["<", ">", "[", "]", "*", "_", "`", "#", "|", "~", "\\"]) {
      expect(reason(`The road ${c} held.`)).toBe("markup");
    }
    expect(reason("See http now.")).toBe("markup");
    expect(reason("See www.example.org now.")).toBe("markup");
  });

  test("numbers, as digits or words", () => {
    expect(proseProblem("The wall held for 3 days.", rules)).toEqual({
      reason: "number",
      detail: "3",
    });
    expect(reason("Two clans rode out.")).toBe("number");
    expect(reason("They lost a dozen carts.")).toBe("number");
    expect(reason("Hundreds of drones came.")).toBe("number");
    expect(reason("It held for twenty-one nights.")).toBe("number");
    expect(reason("Half the market burned.")).toBe("number");
    expect(reason("No one came.")).toBe("number");
    for (const w of ["zero", "nineteen", "ninety", "thousand", "million", "twice", "thrice"]) {
      expect(NUMBER_WORDS.has(w)).toBe(true);
    }
    for (const w of ["a", "an", "first", "last"]) expect(NUMBER_WORDS.has(w)).toBe(false);
  });

  test("a number the template line holds may be repeated when numbersFrom is set", () => {
    const voice = { ...rules, numbersFrom: "Sell 12 ore at 3 coin each, or two crates." };
    expect(reason("I will take 12 ore at 3 coin.", voice)).toBeNull();
    expect(reason("I will take two crates.", voice)).toBeNull();
    expect(reason("I will take 13 ore.", voice)).toBe("number");
    expect(reason("I will take three crates.", voice)).toBe("number");
  });

  test("names: a capitalised word that does not open a sentence must be allowed", () => {
    expect(proseProblem("The wall held beside Zarnok.", rules)).toEqual({
      reason: "name",
      detail: "Zarnok",
    });
    expect(reason("Zarnok held the wall.")).toBeNull();
    expect(reason("The Salt Eaters met the Dust.")).toBeNull();
    expect(reason("Then the Salt-Eaters came.")).toBeNull();
    expect(reason("Then I'm told the wall held.")).toBeNull();
    expect(reason("The wall held: Rustmarket stood.")).toBeNull();
    expect(
      reason("The road to Rustmarket-Salt held.", { ...rules, names: ["Rustmarket", "Salt"] }),
    ).toBeNull();
    expect(reason("The road to Rustmarket-Gate held.", { ...rules, names: ["Rustmarket"] })).toBe(
      "name",
    );
  });

  test("reasons come in a fixed order", () => {
    expect(reason("x".repeat(201) + "@")).toBe("too-long");
    expect(reason("Zarnok saw 3 @ dawn *now*.")).toBe("mention");
    expect(reason("Zarnok saw 3 *now* beside Vex.")).toBe("markup");
    expect(reason("The wall saw 3 beside Vex.")).toBe("number");
  });
});

describe("checkCited", () => {
  const ok = [
    { text: "The wall at Rustmarket held.", facts: [1] },
    { text: "The Salt Eaters kept the road, and the market stood.", facts: [2, 3, 2] },
  ];

  test("every fact cited, each sentence citing one or more", () => {
    expect(checkCited(ok, 3, rules, 6)).toEqual({
      ok: true,
      value: [
        { text: "The wall at Rustmarket held.", facts: [1] },
        { text: "The Salt Eaters kept the road, and the market stood.", facts: [2, 3] },
      ],
    });
  });

  const why = (s: unknown, n = 3, max = 6, r = rules) => {
    const res = checkCited(s, n, r, max);
    return res.ok ? null : res.reason;
  };

  test("each failure has its reason", () => {
    expect(why("text")).toBe("schema");
    expect(why([{ text: 3, facts: [1] }])).toBe("schema");
    expect(why([{ text: "The wall held.", facts: "1" }])).toBe("schema");
    expect(why([{ text: "The wall held.", facts: [1.5] }])).toBe("schema");
    expect(why([null])).toBe("schema");
    expect(why([])).toBe("empty");
    expect(why(ok, 3, 1)).toBe("bad-count");
    expect(why([{ text: "The wall held.", facts: [] }, ...ok])).toBe("uncited");
    expect(why([...ok, { text: "The wall held.", facts: [4] }])).toBe("unknown-fact");
    expect(why([...ok, { text: "The wall held.", facts: [0] }])).toBe("unknown-fact");
    expect(why(ok, 4)).toBe("missing-fact");
    expect(why([{ text: "The wall held for 3 days.", facts: [1, 2, 3] }])).toBe("number");
    expect(why([{ text: "The wall held beside Zarnok.", facts: [1, 2, 3] }])).toBe("name");
    expect(why([{ text: " ", facts: [1, 2, 3] }])).toBe("empty");
    expect(why(ok, 3, 6, { ...rules, maxChars: 60 })).toBe("too-long");
  });

  test("each sentence opens fresh, and the detail says which one failed", () => {
    const res = checkCited([ok[0], { text: "Zarnok came, then Vex.", facts: [2, 3] }], 3, rules, 6);
    expect(res).toEqual({ ok: false, reason: "name", detail: "sentence 2: Vex" });
  });
});
