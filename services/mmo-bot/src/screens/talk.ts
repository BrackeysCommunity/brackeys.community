import type { Button } from "../../../../packages/discord-kit/src/index.ts";
import type * as api from "../api.ts";
import type { Card } from "../card.ts";
import { target } from "../ids.ts";
import { amount, signed } from "../units.ts";
import { back, benchLine, btn, launch, PRIVATE } from "./common.ts";

/** The role that keeps a settlement's bench of practice machines (GDD 7.11). */
const BENCH_KEEPER = "tinker";

/**
 * A conversation: the topics the NPC raises, voiced from templates, and the
 * choices (GDD 4.18). bench is the tinker's bench standing open here, which
 * the tinker's own card leads to. remembers is what the NPC holds of the
 * past, shown when there is any.
 */
export function talkCard(
  o: api.Options,
  conv: api.Conversation,
  said?: string,
  bench?: api.BenchHere,
  remembers?: string,
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
  rows.push({
    buttons: [
      ...(keeps ? [launch("Work at the bench", "talk", v, conv.npc.id)] : []),
      btn("Where I am", "where", "", v),
      back(v),
    ],
  });
  const lines = conv.topics.slice(0, 3).map((t) => `• ${t.line}`);
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
      ...(keeps ? [{ name: "The bench", value: benchLine(keeps), inline: true }] : []),
      ...(remembers ? [{ name: "Remembers", value: remembers }] : []),
    ],
    footer: "What you choose is remembered: by this NPC, and by the people it talks to.",
    rows,
  };
}

function choiceLabel(c: api.Choice): string {
  const line = c.line.replace(/\.$/, "");
  if (c.effect === "standing" && c.standing) return `${line} (${signed(c.standing, "standing")})`;
  if (c.effect === "coin" && c.coin) return `${line} (${signed(c.coin, "coin")})`;
  return line;
}
