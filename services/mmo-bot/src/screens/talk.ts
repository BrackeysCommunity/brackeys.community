import { type Button, EMBED_FIELD_VALUE_MAX } from "../../../../packages/discord-kit/src/index.ts";
import type * as api from "../api.ts";
import type { Card } from "../card.ts";
import { target } from "../ids.ts";
import type { Lexicon } from "../lexicon.ts";
import { splitLines } from "../narration/card.ts";
import { amount, signed } from "../units.ts";
import { back, benchLine, btn, launch, PRIVATE } from "./common.ts";
import { fenceParts } from "./crime.ts";

/** The role that keeps a settlement's bench of practice machines (GDD 7.11). */
const BENCH_KEEPER = "tinker";

/**
 * A conversation (GDD 4.18): the NPC's topics and choices, voiced from templates or by the
 * narration under the same ids. bench is the tinker's open bench; remembers fills one field;
 * sheet is the character's, read when the NPC is a fence, for the hot goods it could sell.
 */
export function talkCard(
  o: api.Options,
  conv: api.Conversation,
  said?: string,
  bench?: api.BenchHere,
  remembers?: string,
  sheet?: api.Sheet,
  lex?: Lexicon,
): Card {
  const v = o.version;
  const keeps = conv.npc.role === BENCH_KEEPER ? bench : undefined;
  const rows: Card["rows"] = [];
  for (const t of conv.topics.slice(0, 3)) {
    const buttons: Button[] = t.choices
      .slice(0, 4)
      .map((c) => btn(choiceLabel(c), "choose", target("/", conv.npc.id, t.id, c.id), v));
    rows.push({ buttons });
  }
  const fence = conv.npc.fence && sheet && lex ? fenceParts(conv.npc.id, sheet, lex, v) : undefined;
  if (fence) rows.push(...fence.rows);
  rows.push({
    buttons: [
      ...(keeps ? [launch("Work at the bench", "talk", v, conv.npc.id)] : []),
      btn("Where I am", "where", "", v),
      back(v),
    ],
  });
  const lines = conv.topics.slice(0, 3).map((t) => `• ${t.line}`);
  const remembered = remembers ? splitLines(remembers, EMBED_FIELD_VALUE_MAX)[0] : undefined;
  return {
    context: PRIVATE,
    author: `${conv.npc.role} · ${conv.met > 1 ? `met ${amount(conv.met, "times")}` : "a first meeting"}`,
    title: conv.npc.name,
    description: [said, conv.last && conv.met > 1 ? `_Last time: "${conv.last}"_` : "", ...lines]
      .filter(Boolean)
      .join("\n\n"),
    picture: { media: conv.banner, alt: `Banner of where you meet ${conv.npc.name}` },
    fields: [
      { name: "Traits", value: conv.npc.traits.join(", ") || "none shown", inline: true },
      ...(conv.npc.mood ? [{ name: "Toward you", value: conv.npc.mood, inline: true }] : []),
      ...(keeps ? [{ name: "The bench", value: benchLine(keeps), inline: true }] : []),
      ...(fence?.fields ?? []),
      ...(remembered ? [{ name: "Remembers", value: remembered }] : []),
    ],
    footer: "What you choose is remembered: by this NPC, and by the people it talks to.",
    rows,
  };
}

/** A choice's button: its line, and what it costs or pays where it does. */
export function choiceLabel(c: api.Choice): string {
  const line = c.line.replace(/\.$/, "");
  if (c.effect === "standing" && c.standing) return `${line} (${signed(c.standing, "standing")})`;
  if (c.effect === "coin" && c.coin) return `${line} (${signed(c.coin, "coin")})`;
  if (c.effect === "fine") return c.coin ? `${line} (${amount(c.coin, "coin")})` : line;
  if (c.effect === "return") return `${line} (gives back what you took)`;
  return line;
}
