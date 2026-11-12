import type { BlobKindDef, InspectResult } from "../kinds/define";
import type { AssetEntry, AssetId, AssetPath } from "../types";
import { importFailed } from "./result";

/**
 * A blob entry's meta from its bytes and import settings, the way every
 * host derives it: `idAt` resolves the names the file makes (an atlas's
 * image), an inspector that throws is `import-failed`, and the settings the
 * inspection fills join the entry's own, which win.
 */
export function inspectEntry(
  def: BlobKindDef,
  entry: Pick<AssetEntry, "path" | "import">,
  bytes: Uint8Array,
  idAt: (path: AssetPath) => AssetId | undefined,
): InspectResult<unknown> {
  const env = { path: entry.path, idAt };
  let result: InspectResult<unknown>;
  try {
    result = def.inspect(bytes, entry.import ?? {}, env);
  } catch {
    return importFailed(def.kind, env, "its inspector threw");
  }
  if (!result.ok) return result;
  const settings = { ...result.import, ...entry.import };
  return Object.keys(settings).length === 0
    ? { ok: true, meta: result.meta }
    : { ok: true, meta: result.meta, import: settings };
}
