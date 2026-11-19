import type { Button } from "../../../../packages/discord-kit/src/index.ts";
import type * as api from "../api.ts";
import type { Card } from "../card.ts";
import { target } from "../ids.ts";
import { amount, signed } from "../units.ts";
import { back, btn, PRIVATE } from "./common.ts";

/** A conversation: the topics the NPC raises, voiced from templates, and the choices (GDD 4.18). */
export function talkCard(o: api.Options, conv: api.Conversation, said?: string): Card {
  const v = o.version;
  const rows: Card["rows"] = [];
  for (const t of conv.topics.slice(0, 3)) {
    const buttons: Button[] = t.choices
      .slice(0, 4)
      .map((c) => btn(choiceLabel(c), "choose", target("/", conv.npc.id, t.id, c.id), v));
    rows.push({ buttons });
  }
  rows.push({ buttons: [btn("Where I am", "where", "", v), back(v)] });
  const lines = conv.topics.slice(0, 3).map((t) => `• ${t.line}`);
  return {
    context: PRIVATE,
    author: `${conv.npc.role} · ${conv.met > 1 ? `met ${amount(conv.met, "times")}` : "a first meeting"}`,
    title: conv.npc.name,
    description: [said, conv.last && conv.met > 1 ? `_Last time: "${conv.last}"_` : "", ...lines]
      .filter(Boolean)
      .join("\n\n"),
    picture: { media: conv.banner, alt: `Banner of where you meet ${conv.npc.name}` },
    fields: [{ name: "Traits", value: conv.npc.traits.join(", ") || "none shown", inline: true }],
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
