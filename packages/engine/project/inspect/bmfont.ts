import { z } from "zod";

import { codePointRanges, type CodePointRanges } from "./font-cmap";

const intText = z
  .string()
  .regex(/^\d{1,9}$/)
  .transform(Number);
const signedText = z
  .string()
  .regex(/^-?\d{1,9}$/)
  .transform(Number);
const numberText = z
  .string()
  .regex(/^-?\d{1,9}(?:\.\d{1,9})?$/)
  .transform(Number);
const codePointText = intText.refine((cp) => cp <= 0x10ffff);

const infoSchema = z.object({ size: signedText.optional() });
const commonSchema = z.object({ lineHeight: intText, pages: intText.optional() });
const pageSchema = z.object({ id: intText, file: z.string().min(1) });
const charSchema = z.object({ id: codePointText, xadvance: numberText });
const kerningSchema = z.object({ first: codePointText, second: codePointText, amount: numberText });
const fieldSchema = z.object({
  fieldType: z.string(),
  distanceRange: numberText.refine((range) => range > 0).optional(),
});

/** Field types a BMFont names, as the renderer draws them; MTSDF's colour channels are MSDF's. */
const FIELD_TYPES: Readonly<Record<string, "msdf" | "sdf" | "none">> = {
  msdf: "msdf",
  mtsdf: "msdf",
  sdf: "sdf",
  none: "none",
};

export type BmfontDistanceField = { type: "msdf" | "sdf"; range: number };

/** What a BMFont gives for layout: never the glyph rectangles, which only the renderer needs. */
export type Bmfont = {
  lineHeight: number;
  /** Page files in page id order, relative to the .fnt. */
  pages: string[];
  size?: number;
  /** `xadvance` by decimal code point, ascending. */
  advances?: Record<string, number>;
  /** Non-zero pairs, by first then second code point. */
  kerning?: [first: number, second: number, amount: number][];
  distanceField?: BmfontDistanceField;
  coverage?: CodePointRanges;
};

type BmfontTag = { tag: string; attrs: Record<string, string> };

const ATTRIBUTE = /(\w+)=("[^"]*"|\S*)/g;

/** A text line's tag and its `key=value` attributes; quoted values lose their quotes. */
function parseLine(line: string): BmfontTag | null {
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

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-z]+);/g, (whole, name: string) => {
    if (!name.startsWith("#")) return ENTITIES[name] ?? whole;
    const cp = name[1] === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
  });
}

const ELEMENT = /<([A-Za-z]\w*)([^<>]*)>/g;
const XML_ATTRIBUTE = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** The XML format's elements in document order, or null when it isn't a `<font>` document. */
function xmlTags(text: string): BmfontTag[] | null {
  const tags: BmfontTag[] = [];
  for (const [, tag, body] of text.replace(/<!--[\s\S]*?-->/g, "").matchAll(ELEMENT)) {
    if (tag === undefined) continue;
    const attrs: Record<string, string> = Object.create(null);
    for (const [, key, double, single] of (body ?? "").matchAll(XML_ATTRIBUTE))
      if (key !== undefined) attrs[key] = decodeEntities(double ?? single ?? "");
    tags.push({ tag, attrs });
  }
  return tags[0]?.tag === "font" ? tags : null;
}

function textTags(text: string): BmfontTag[] {
  return text.split(/\r?\n/).flatMap((line) => parseLine(line) ?? []);
}

/**
 * A BMFont's layout from its text or XML format: line height, page files,
 * face size, advances, kerning, a distance field and the code points it
 * has glyphs for. Null for the binary variant, a missing `common`, page
 * ids that aren't 0…n-1 matching `common pages`, a repeated char or
 * kerning pair, or a distance field type it can't draw.
 */
export function parseBmfont(text: string): Bmfont | null {
  if (typeof text !== "string") return null;
  const body = text.replace(/^﻿/, "");
  const tags = body.trimStart().startsWith("<") ? xmlTags(body) : textTags(body);
  if (!tags) return null;
  let info: z.infer<typeof infoSchema> | null = null;
  let common: z.infer<typeof commonSchema> | null = null;
  let field: BmfontDistanceField | "none" | null = null;
  const pages = new Map<number, string>();
  const advances = new Map<number, number>();
  const kerning = new Map<string, [number, number, number]>();
  for (const { tag, attrs } of tags) {
    if (tag === "info") {
      if (info) return null;
      const result = infoSchema.safeParse(attrs);
      if (!result.success) return null;
      info = result.data;
    } else if (tag === "common") {
      if (common) return null;
      const result = commonSchema.safeParse(attrs);
      if (!result.success) return null;
      common = result.data;
    } else if (tag === "page") {
      const result = pageSchema.safeParse(attrs);
      if (!result.success || pages.has(result.data.id)) return null;
      pages.set(result.data.id, result.data.file);
    } else if (tag === "char") {
      const result = charSchema.safeParse(attrs);
      if (!result.success || advances.has(result.data.id)) return null;
      advances.set(result.data.id, result.data.xadvance);
    } else if (tag === "kerning") {
      const result = kerningSchema.safeParse(attrs);
      if (!result.success) return null;
      const { first, second, amount } = result.data;
      const key = `${first},${second}`;
      if (kerning.has(key)) return null;
      kerning.set(key, [first, second, amount]);
    } else if (tag === "distanceField") {
      const result = fieldSchema.safeParse(attrs);
      const type = result.success ? FIELD_TYPES[result.data.fieldType] : undefined;
      if (field || !result.success || type === undefined) return null;
      if (type === "none") field = "none";
      else if (result.data.distanceRange === undefined) return null;
      else field = { type, range: result.data.distanceRange };
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
  const font: Bmfont = { lineHeight: common.lineHeight, pages: files };
  const size = Math.abs(info?.size ?? 0);
  if (size > 0) font.size = size;
  if (advances.size > 0) {
    const ids = [...advances.keys()].sort((a, b) => a - b);
    font.advances = {};
    for (const id of ids) font.advances[String(id)] = advances.get(id) ?? 0;
    font.coverage = codePointRanges(ids);
  }
  const pairs = [...kerning.values()]
    .filter(([, , amount]) => amount !== 0)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pairs.length > 0) font.kerning = pairs;
  if (field && field !== "none") font.distanceField = field;
  return font;
}
