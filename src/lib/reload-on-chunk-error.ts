/**
 * After a deploy, a page loaded from the previous build references hashed
 * chunks the origin no longer has. The first lazy import that 404s would
 * otherwise leave the app wedged on a skeleton; a single reload picks up
 * fresh HTML pointing at the live build. The timestamp guard keeps a
 * genuine outage (offline, blocked requests) from turning into a reload
 * loop — after one attempt the error is allowed to surface normally.
 */
export function reloadOnChunkError() {
  if (typeof window === "undefined") return;
  window.addEventListener("vite:preloadError", (event) => {
    const KEY = "chunk-reload-at";
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(KEY) ?? 0);
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch {
      // Storage unavailable (privacy mode) — still try the one reload;
      // worst case the guard is per-load instead of per-session.
    }
    if (Date.now() - last < 30_000) return;
    event.preventDefault();
    window.location.reload();
  });
}
