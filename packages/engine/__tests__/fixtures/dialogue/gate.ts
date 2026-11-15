/**
 * The gate conversation: a guard asks a toll. Paying (with 3 gold or more)
 * ends at "paid" and opens the gate; turning back ends at "left". The
 * guard has a portrait and the first line a voice. Its strings speak `en`
 * and `fr`, every key in both.
 */
import { docLookup, type DocLookup } from "../../../project/kinds/define";
import type { DialogueFile } from "../../../project/kinds/dialogue";
import type { LocaleSettings, StringsFile } from "../../../project/kinds/strings";

export const GATE_ID = "gate-talk";
export const GATE_STRINGS_ID = "gate-strings";
/** The atlas the guard's portrait is a frame of, and the sound of the voiced line. */
export const GATE_PORTRAITS = "portraits";
export const GATE_VOICE = "vo-guard-halt";
export const GATE_ENDINGS = ["paid", "left"] as const;

export const GATE_DIALOGUE: DialogueFile = {
  kind: "dialogue",
  v: 1,
  start: "gate",
  speakers: [
    { id: "guard", name: "speaker.guard", portrait: { asset: GATE_PORTRAITS, frame: "guard" } },
  ],
  nodes: [
    {
      id: "gate",
      lines: [{ speaker: "guard", text: "gate.halt", voice: GATE_VOICE }],
      choices: [
        {
          text: "gate.pay",
          if: { var: "/gold", gte: 3 },
          do: [{ add: "/gold", by: -3 }],
          to: "through",
        },
        { text: "gate.leave", to: "turned-away" },
      ],
    },
    {
      id: "through",
      lines: [{ speaker: "guard", text: "gate.go-on" }],
      do: [{ set: "/flags/gate-open", to: true }],
      end: "paid",
    },
    { id: "turned-away", lines: [{ speaker: "guard", text: "gate.later" }], end: "left" },
  ],
};

export const GATE_STRINGS: StringsFile = {
  kind: "strings",
  v: 1,
  strings: [
    { key: "speaker.guard", en: "Guard", fr: "Garde" },
    {
      key: "gate.halt",
      en: "Halt! The toll is three gold.",
      fr: "Halte ! Le péage coûte trois pièces.",
    },
    { key: "gate.pay", en: "Pay three gold.", fr: "Payer trois pièces." },
    { key: "gate.leave", en: "Turn back.", fr: "Faire demi-tour." },
    { key: "gate.go-on", en: "Go on through.", fr: "Passez." },
    { key: "gate.later", en: "Come back with coin.", fr: "Revenez avec de l'argent." },
  ],
};

export const GATE_LOCALES: LocaleSettings = { default: "en", available: ["en", "fr"] };

/** A fresh copy of the gate conversation, to change in a test. */
export const gateDialogue = (): DialogueFile => structuredClone(GATE_DIALOGUE);

/**
 * A lookup over the gate conversation, its strings (`strings`, default
 * `GATE_STRINGS`) and a game-settings doc offering `GATE_LOCALES`.
 */
export function gateLookup(
  opts: { dialogue?: DialogueFile; strings?: StringsFile; locales?: LocaleSettings } = {},
): DocLookup {
  return docLookup(
    new Map<string, Map<string, unknown>>([
      ["dialogue", new Map([[GATE_ID, opts.dialogue ?? GATE_DIALOGUE]])],
      ["strings", new Map([[GATE_STRINGS_ID, opts.strings ?? GATE_STRINGS]])],
      [
        "game-settings",
        new Map([
          [
            "game-settings",
            {
              kind: "game-settings",
              v: 2,
              engine: { locales: opts.locales ?? GATE_LOCALES },
              game: {},
            },
          ],
        ]),
      ],
    ]),
  );
}
