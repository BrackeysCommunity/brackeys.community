import { STORAGE_KEYS } from "@/lib/storage-keys";
import { resolveThemeId } from "@/lib/themes";

/**
 * Carries browser preferences across the rename to jams.team, in two ways:
 *
 * - Same origin: keys stored under their old `brackeys-*` / `brackeys:*`
 *   names move to their `jt:*` names, so nobody on jams.team loses an
 *   analytics opt-out, a motion setting or an unsent draft to the rename.
 * - Across origins: the old host's redirect page reads an allowlist of
 *   preferences and sends the visitor to jams.team with
 *   `#handoff=<base64url JSON>`, an object keyed by the old key names. The
 *   fragment never reaches a server. Drafts are never in it.
 *
 * Either way a value already stored under the new name wins, and the
 * fragment is stripped from the URL before anything else reads it.
 */

const LEGACY_KEYS: Record<string, string> = {
  "brackeys-analytics": STORAGE_KEYS.analytics,
  "brackeys-theme": STORAGE_KEYS.theme,
  "brackeys-reduce-motion": STORAGE_KEYS.reduceMotion,
  "brackeys-muted": STORAGE_KEYS.muted,
  "brackeys-volume": STORAGE_KEYS.volume,
  "brackeys-censor-profanity": STORAGE_KEYS.censorProfanity,
  "brackeys-attention-dismissed": STORAGE_KEYS.attentionDismissed,
  "brackeys:glow-colour-space": STORAGE_KEYS.glowColourSpace,
  "brackeys:workspace-scope": STORAGE_KEYS.workspaceScope,
  "brackeys:canvas-inspector": STORAGE_KEYS.canvasInspector,
  "brackeys:forum-composer-draft:v1": STORAGE_KEYS.forumDraft,
  "brackeys:collab-wizard-draft:v1": STORAGE_KEYS.collabDraft,
};

const oneOf =
  (...allowed: string[]) =>
  (value: string) =>
    allowed.includes(value) ? value : null;

/** The preferences a handoff may carry, each with the values it accepts. */
const HANDOFF_PREFERENCES: Record<string, (value: string) => string | null> = {
  "brackeys-analytics": oneOf("on", "off"),
  "brackeys-theme": resolveThemeId,
  "brackeys-reduce-motion": oneOf("0", "1", "system", "reduced", "full"),
  "brackeys-muted": oneOf("0", "1"),
  "brackeys-volume": (value) => {
    const n = Number(value);
    return value !== "" && Number.isFinite(n) && n >= 0 && n <= 1 ? String(n) : null;
  },
  "brackeys-censor-profanity": oneOf("0", "1"),
};

const HANDOFF_PREFIX = "#handoff=";
const MAX_HANDOFF_LENGTH = 2_048;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

/** Moves every value under an old key to its new name, then drops the old key. */
export function migrateLegacyKeys(storage: Storage): string[] {
  const written: string[] = [];
  for (const [legacy, current] of Object.entries(LEGACY_KEYS)) {
    const value = storage.getItem(legacy);
    if (value === null) continue;
    if (storage.getItem(current) === null) {
      storage.setItem(current, current === STORAGE_KEYS.theme ? resolveThemeId(value) : value);
      written.push(current);
    }
    storage.removeItem(legacy);
  }
  return written;
}

function decodeBase64Url(input: string): string {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** The allowlisted preferences in a `#handoff=` fragment, under their new names. */
export function parseHandoff(hash: string): Record<string, string> {
  if (!hash.startsWith(HANDOFF_PREFIX)) return {};
  const encoded = hash.slice(HANDOFF_PREFIX.length);
  if (encoded.length === 0 || encoded.length > MAX_HANDOFF_LENGTH) return {};

  let payload: unknown;
  try {
    payload = JSON.parse(decodeBase64Url(encoded));
  } catch {
    return {};
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return {};

  const prefs: Record<string, string> = {};
  for (const [legacy, accept] of Object.entries(HANDOFF_PREFERENCES)) {
    const raw = (payload as Record<string, unknown>)[legacy];
    if (typeof raw !== "string") continue;
    const value = accept(raw);
    if (value !== null) prefs[LEGACY_KEYS[legacy]] = value;
  }
  return prefs;
}

/** Writes handed-off preferences that this origin doesn't already have. */
export function applyHandoff(storage: Storage, prefs: Record<string, string>): string[] {
  const written: string[] = [];
  for (const [key, value] of Object.entries(prefs)) {
    if (storage.getItem(key) !== null) continue;
    storage.setItem(key, value);
    written.push(key);
  }
  return written;
}

/**
 * The pre-paint script in the document head has already run against an
 * empty store by the time this does, so a theme or motion setting written
 * here is applied to `<html>` directly.
 */
function reflectOnDocument(storage: Storage, written: string[]) {
  const root = document.documentElement;
  if (written.includes(STORAGE_KEYS.theme)) {
    root.setAttribute("data-theme", resolveThemeId(storage.getItem(STORAGE_KEYS.theme)));
  }
  if (written.includes(STORAGE_KEYS.reduceMotion)) {
    const pref = storage.getItem(STORAGE_KEYS.reduceMotion);
    const reduced =
      pref === "1" || pref === "reduced"
        ? true
        : pref === "full"
          ? false
          : (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    root.dataset.reduceMotion = reduced ? "true" : "false";
  }
}

/** Runs once on the client, before the router reads the URL. */
export function bootStorageHandoff() {
  if (typeof window === "undefined") return;
  const { hash, pathname, search } = window.location;
  const handingOff = hash.startsWith(HANDOFF_PREFIX);

  try {
    const storage = window.localStorage;
    const written = migrateLegacyKeys(storage);
    if (handingOff) written.push(...applyHandoff(storage, parseHandoff(hash)));
    reflectOnDocument(storage, written);
  } catch {
    // storage unavailable: nothing to carry over
  }

  if (handingOff) {
    window.history.replaceState(window.history.state, "", pathname + search);
  }
}
