import { defineAssetKind } from "./define";

/** Game code: modules the project file's `code` globs name, listed read-only and never a doc. */
export const codeKind = defineAssetKind({
  kind: "code",
  title: "Code",
  description: "Game code: TypeScript modules, edited in git and listed read-only.",
  match: {},
  storage: "code",
});
