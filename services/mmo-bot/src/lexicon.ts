import { capital, readable } from "../../../packages/mmo-words/src/units.ts";
import type * as api from "./api.ts";

export { capital as capitalise, readable };

/** What the setting calls things, and the sheet numbers cards state, from the world's lexicon; `update` swaps in a fresh read. */
export class Lexicon {
  constructor(private data: api.Lexicon) {}

  /** Takes a lexicon read again from the world. */
  update(data: api.Lexicon): void {
    this.data = data;
  }

  /** A sheet row's name, or its id made readable. */
  name(sheet: string, id: string): string {
    return this.data.names[`${sheet}:${id}`] ?? readable(id);
  }
  /** Whether the setting names a sheet's row: how a card tells a machine family from any other id. */
  names(sheet: string, id: string): boolean {
    return `${sheet}:${id}` in this.data.names;
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
