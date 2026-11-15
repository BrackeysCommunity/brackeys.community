import type { Sha256 } from "../project/types";

/** The CSS family a web font is registered under: one per content hash, for canvas text and the DOM helpers alike. */
export const webFontFamily = (hash: Sha256): string => `jams-font-${hash}`;

function registered(fonts: FontFaceSet, family: string): FontFace | null {
  const all = fonts as unknown as Partial<Iterable<FontFace>>;
  if (typeof all[Symbol.iterator] !== "function") return null;
  for (const face of all as Iterable<FontFace>)
    if (face.family.replace(/"/g, "") === family) return face;
  return null;
}

type FontBytes = string | ArrayBuffer;

/**
 * The web font `hash` in `doc.fonts`, added from `source` (its bytes, or a
 * URL; read only when it has to be added) unless a face of its family is
 * there already; `added` says which. Null where the document has no font
 * set or `FontFace`, or `source` gives nothing.
 */
export function ensureWebFont(
  doc: Document,
  hash: Sha256,
  source: FontBytes | (() => FontBytes | null),
): { face: FontFace; added: boolean } | null {
  const fonts = doc.fonts as FontFaceSet | undefined;
  const Face = doc.defaultView?.FontFace ?? globalThis.FontFace;
  if (!fonts || typeof Face !== "function") return null;
  const family = webFontFamily(hash);
  const found = registered(fonts, family);
  if (found) return { face: found, added: false };
  const bytes = typeof source === "function" ? source() : source;
  if (bytes === null) return null;
  const face = new Face(
    family,
    typeof bytes === "string" ? `url(${JSON.stringify(bytes)})` : bytes,
  );
  fonts.add(face);
  return { face, added: true };
}
