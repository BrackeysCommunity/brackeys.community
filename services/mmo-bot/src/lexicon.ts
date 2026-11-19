import type * as api from "./api.ts";

/** What the setting calls things, from the world's lexicon. */
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
}

export function readable(id: string): string {
  const s = id.replace(/[-_]/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
