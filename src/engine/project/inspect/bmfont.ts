import { z } from "zod";

const intText = z
  .string()
  .regex(/^\d{1,9}$/)
  .transform(Number);

const commonSchema = z.object({ lineHeight: intText, pages: intText.optional() });
const pageSchema = z.object({ id: intText, file: z.string().min(1) });

const ATTRIBUTE = /(\w+)=("[^"]*"|\S*)/g;

/** A line's tag and its `key=value` attributes; quoted values lose their quotes. */
function parseLine(line: string): { tag: string; attrs: Record<string, string> } | null {
  const tag = /^\s*(\w+)/.exec(line)?.[1];
  if (tag === undefined) return null;
  const attrs: Record<string, string> = Object.create(null);
  for (const [, key, value] of line.matchAll(ATTRIBUTE)) {
    if (key === undefined || value === undefined) continue;
    const quoted = value.length >= 2 && value.startsWith('"') && value.endsWith('"');
    attrs[key] = quoted ? value.slice(1, -1) : value;
  }
  return { tag, attrs };
}

/**
 * A text BMFont's line height and page files (in page id order, relative to
 * the .fnt). Null for the binary and XML variants, a missing `common` line,
 * or page ids that aren't 0…n-1 matching `common pages`.
 */
export function parseBmfont(text: string): { lineHeight: number; pages: string[] } | null {
  if (typeof text !== "string") return null;
  let common: z.infer<typeof commonSchema> | null = null;
  const pages = new Map<number, string>();
  for (const line of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (!parsed) continue;
    if (parsed.tag === "common") {
      if (common) return null;
      const result = commonSchema.safeParse(parsed.attrs);
      if (!result.success) return null;
      common = result.data;
    } else if (parsed.tag === "page") {
      const result = pageSchema.safeParse(parsed.attrs);
      if (!result.success || pages.has(result.data.id)) return null;
      pages.set(result.data.id, result.data.file);
    }
  }
  if (!common || common.lineHeight === 0 || pages.size === 0) return null;
  if (common.pages !== undefined && common.pages !== pages.size) return null;
  const files: string[] = [];
  for (let id = 0; id < pages.size; id++) {
    const file = pages.get(id);
    if (file === undefined) return null;
    files.push(file);
  }
  return { lineHeight: common.lineHeight, pages: files };
}
