import type * as api from "./api.ts";

/** What the setting calls things, and the sheet numbers cards state, from the world's lexicon. */
export class Lexicon {
  constructor(private readonly data: api.Lexicon) {}

  /** A sheet row's name, or its id made readable. */
  name(sheet: string, id: string): string {
    return this.data.names[`${sheet}:${id}`] ?? readable(id);
  }
  material(id: string): string {
    return id === "provisions" ? "provisions" : this.name("items.materials", id);
  }
  /** Every name a good goes by, lower case: goods are their own unit. */
  goodsNames(): Set<string> {
    const out = new Set<string>(["provisions"]);
    for (const [ref, n] of Object.entries(this.data.names)) {
      if (ref.startsWith("items.materials:") || ref.startsWith("mounts.kinds:"))
        out.add(n.toLowerCase());
    }
    return out;
  }
  get starts(): readonly string[] {
    return this.data.starts;
  }
  bandRank(id: string): number {
    const rank = this.data.bands.indexOf(id);
    return rank < 0 ? this.data.bands.length : rank;
  }
  get numbers(): api.Numbers {
    return this.data.numbers;
  }
}

export function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** An id as words: dashes and underscores to spaces, capitalised. */
export function readable(id: string): string {
  return capitalise(id.replace(/[-_]/g, " "));
}
