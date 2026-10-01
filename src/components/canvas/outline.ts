import { basename } from "@/lib/canvas/paths";
import { externalUrlHost } from "@/lib/external-url";

import type { CanvasCard } from "./canvas-cards";

export interface OutlineEdge {
  from: string;
  to: string;
  label?: string;
}

export interface OutlineItem {
  card: CanvasCard;
  /** For a group: the cards inside it, in reading order. */
  children: OutlineItem[];
}

function inside(inner: CanvasCard, outer: CanvasCard): boolean {
  return (
    inner.id !== outer.id &&
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

/**
 * Top-left to bottom-right: cards whose tops fall within the upper half of
 * the row's first card read as one row, left to right.
 */
export function readingOrder<T extends Pick<CanvasCard, "x" | "y" | "h">>(cards: T[]): T[] {
  const byTop = [...cards].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: T[] = [];
  let row: T[] = [];
  let rowEnd = -Infinity;
  for (const card of byTop) {
    if (row.length && card.y >= rowEnd) {
      out.push(...row.sort((a, b) => a.x - b.x));
      row = [];
    }
    if (!row.length) rowEnd = card.y + card.h / 2;
    row.push(card);
  }
  out.push(...row.sort((a, b) => a.x - b.x));
  return out;
}

/** Each card under the smallest group that wholly contains it, in reading order. */
export function canvasOutline(cards: CanvasCard[]): OutlineItem[] {
  const groups = cards.filter((c) => c.type === "group");
  const parent = new Map<string, string>();
  for (const card of cards) {
    let best: CanvasCard | null = null;
    for (const group of groups) {
      if (inside(card, group) && (!best || group.w * group.h < best.w * best.h)) best = group;
    }
    if (best) parent.set(card.id, best.id);
  }
  const childrenOf = new Map<string | null, CanvasCard[]>();
  for (const card of cards) {
    const key = parent.get(card.id) ?? null;
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), card]);
  }
  const build = (key: string | null): OutlineItem[] =>
    readingOrder(childrenOf.get(key) ?? []).map((card) => ({
      card,
      children: card.type === "group" ? build(card.id) : [],
    }));
  return build(null);
}

/** Every card in outline order, groups before what they hold: the canvas's tab order. */
export function flattenOutline(items: OutlineItem[]): CanvasCard[] {
  return items.flatMap((item) => [item.card, ...flattenOutline(item.children)]);
}

export function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((l) => l.replace(/^[#>\-*\s]+/, "").trim())
      .find(Boolean) ?? ""
  );
}

/** A card named in a line: what the outline, edge lines and screen readers call it. */
export function cardTitle(card: CanvasCard, entityTitle?: string): string {
  switch (card.type) {
    case "text":
      return firstLine(card.text ?? "").slice(0, 120) || "Empty card";
    case "group":
      return card.label || "Group";
    case "file":
    case "image":
      return basename(card.file ?? "") || (card.type === "image" ? "Image" : "File");
    case "link":
      return externalUrlHost(card.url ?? "") ?? (card.url || "Link");
    case "entity":
      return entityTitle ?? card.url ?? "Live card";
  }
}

const TYPE_LABEL: Record<CanvasCard["type"], string> = {
  text: "Text card",
  group: "Group",
  file: "Note",
  image: "Image",
  link: "Link",
  entity: "Live card",
};

export function cardAriaLabel(card: CanvasCard): string {
  return `${TYPE_LABEL[card.type]}: ${cardTitle(card)}`;
}

function cardMarkdown(card: CanvasCard): string {
  switch (card.type) {
    case "text":
      return (card.text ?? "").trim();
    case "file":
      return `[[${card.file ?? ""}${card.subpath ?? ""}]]`;
    case "image":
      return `![[${card.file ?? ""}]]`;
    case "link":
    case "entity":
      return card.url ? `[${cardTitle(card)}](${card.url})` : cardTitle(card);
    case "group":
      return "";
  }
}

/**
 * The outline as Markdown: groups become headings, cards paragraphs, and
 * each card's outgoing arrows "→ linked to …" lines under it.
 */
export function outlineMarkdown(items: OutlineItem[], edges: OutlineEdge[]): string {
  const titles = new Map<string, string>();
  const walk = (list: OutlineItem[]) => {
    for (const item of list) {
      titles.set(item.card.id, cardTitle(item.card));
      walk(item.children);
    }
  };
  walk(items);

  const blocks: string[] = [];
  const emit = (list: OutlineItem[], depth: number) => {
    for (const { card, children } of list) {
      if (card.type === "group") {
        blocks.push(`${"#".repeat(Math.min(6, depth))} ${cardTitle(card)}`);
        emit(children, depth + 1);
        continue;
      }
      const body = cardMarkdown(card);
      const links = edges
        .filter((e) => e.from === card.id && titles.has(e.to))
        .map((e) => `→ linked to ${titles.get(e.to)}${e.label ? ` (${e.label})` : ""}`);
      const block = [body, ...links].filter(Boolean).join("\n\n");
      if (block) blocks.push(block);
    }
  };
  emit(items, 1);
  return `${blocks.join("\n\n")}\n`;
}
