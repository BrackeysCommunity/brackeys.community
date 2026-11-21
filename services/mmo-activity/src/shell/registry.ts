import type { Family } from "./kit.ts";

// Every folder under src/scenes is a family; adding one edits nothing here.
const found = import.meta.glob<{ default: Family }>("../scenes/*/index.ts", { eager: true });

const families = new Map<string, Family>();
for (const [path, mod] of Object.entries(found)) {
  const folder = path.split("/").at(-2)!;
  const family = mod.default;
  if (family.id !== folder)
    throw new Error(`the scene in src/scenes/${folder} names itself ${family.id}`);
  families.set(family.id, family);
}

export function familyOf(id: string): Family | undefined {
  return families.get(id);
}

/** Every registered family id, sorted. */
export function registered(): string[] {
  return [...families.keys()].sort();
}
