import type { SaveStore, SaveSummary } from "@jams/engine";
import { parseSaveFile } from "@jams/engine/game";
import { makeIssue } from "@jams/engine/scene";

/** The page query naming the game's save server: `index.html?host=jams&saves=<origin>`. */
export const SAVE_SERVER_PARAM = "saves";

export const OWN_SAVES_DESCRIBE = "Saves go to this game's own server.";

/** The save server the page's query names, or null outside a browser or without one. */
export function saveServerOrigin(): string | null {
  if (typeof location === "undefined") return null;
  const named = new URLSearchParams(location.search).get(SAVE_SERVER_PARAM);
  if (!named) return null;
  try {
    return new URL(named).origin;
  } catch {
    return null;
  }
}

const slotPath = (origin: string, gameId: string, slot: string) =>
  `${origin}/saves/${encodeURIComponent(gameId)}/${encodeURIComponent(slot)}`;

/**
 * The game's own save backend: every save goes to the server `origin`
 * names, never to the page hosting the game. Writes are plain-text POSTs,
 * a CORS simple request, so the browser sends no preflight.
 */
export function ownServerStore(origin: string | null): SaveStore {
  const unreachable = () =>
    makeIssue("save-store-failed", { message: "This page names no save server." });
  return {
    kind: "game",
    describe: OWN_SAVES_DESCRIBE,
    async list(gameId) {
      if (!origin) return [];
      try {
        const response = await fetch(`${origin}/saves/${encodeURIComponent(gameId)}`);
        if (!response.ok) return [];
        const texts = (await response.json()) as { slot: string; text: string }[];
        const out: SaveSummary[] = [];
        for (const { slot, text } of texts) {
          const parsed = parseSaveFile(text);
          if (parsed.ok)
            out.push({
              slot,
              meta: parsed.file.meta,
              bytes: new TextEncoder().encode(text).length,
            });
        }
        return out;
      } catch {
        return [];
      }
    },
    async read(gameId, slot) {
      if (!origin) return null;
      try {
        const response = await fetch(slotPath(origin, gameId, slot));
        return response.ok ? await response.text() : null;
      } catch {
        return null;
      }
    },
    async write(gameId, slot, text) {
      if (!origin) return { ok: false, issue: unreachable() };
      try {
        const response = await fetch(slotPath(origin, gameId, slot), {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: text,
        });
        if (!response.ok)
          return {
            ok: false,
            issue: makeIssue("save-store-failed", {
              message: `The save server answered ${response.status}.`,
            }),
          };
        return { ok: true, bytes: new TextEncoder().encode(text).length };
      } catch (error) {
        return {
          ok: false,
          issue: makeIssue("save-store-failed", {
            message: `The save server can't be reached: ${error instanceof Error ? error.message : String(error)}`,
          }),
        };
      }
    },
    async remove(gameId, slot) {
      if (!origin) return;
      try {
        await fetch(`${slotPath(origin, gameId, slot)}/remove`, { method: "POST" });
      } catch {
        // A save that can't be removed stays listed; the game keeps running.
      }
    },
  };
}
