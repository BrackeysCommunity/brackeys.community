import { EMBED_FIELD_VALUE_MAX } from "../../../../packages/discord-kit/src/index.ts";
import type { Card } from "../card.ts";

/**
 * A template card told in prose: the prose is the description, and the
 * template's own lines move into fields named recordName, so every fact
 * and number the template showed is still on the card (GDD 15.1(3)).
 */
export function withProse(template: Card, prose: string, recordName = "The record"): Card {
  const record = splitLines(template.description ?? "", EMBED_FIELD_VALUE_MAX).map((value) => ({
    name: recordName,
    value,
  }));
  return {
    ...template,
    description: prose,
    fields: [...record, ...(template.fields ?? [])],
  };
}

/** Text cut into pieces of at most max characters, on line boundaries where a line fits. */
export function splitLines(text: string, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const line of text.split("\n")) {
    const pieces = line.length > max ? chunk(line, max) : [line];
    for (const p of pieces) {
      const next = cur ? `${cur}\n${p}` : p;
      if (next.length <= max) {
        cur = next;
        continue;
      }
      if (cur.trim()) out.push(cur);
      cur = p;
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function chunk(s: string, max: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max));
  return out;
}
