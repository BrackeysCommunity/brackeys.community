import "@/polyfill";
import { createFileRoute } from "@tanstack/react-router";

import { db } from "@/db";
import {
  applyUnsubscribe,
  isKnownNotificationType,
  resolveUnsubscribeToken,
} from "@/lib/unsubscribe";

/**
 * Handles email unsubscribe links. The same URL is wired into:
 *   - `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058)
 *     — mail providers POST to it with no body when a recipient clicks
 *     the inbox "unsubscribe" affordance.
 *   - The unsubscribe link inside the email body — humans GET it.
 *
 * GET renders a tiny confirmation page. POST flips prefs immediately
 * and returns 204. Both shapes accept `?token=...&type=...` where the
 * type is optional; missing type means "all email off."
 *
 * Auth-free by design — the token *is* the authorization. We respond
 * 200 even on an unknown token so harvesters can't probe.
 */
async function handle({ request }: { request: Request }) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const typeParam = url.searchParams.get("type");

  const userId = await resolveUnsubscribeToken(db, token);
  if (!userId) {
    // Same shape for GET vs POST so we don't leak token validity.
    return renderResult({
      method: request.method,
      ok: true,
      headline: "You're unsubscribed.",
      detail: "If you keep getting email, reply to the message and we'll take a look.",
    });
  }

  const scope = typeParam && isKnownNotificationType(typeParam) ? typeParam : ("all" as const);

  await applyUnsubscribe(db, userId, scope);

  return renderResult({
    method: request.method,
    ok: true,
    headline: scope === "all" ? "You're unsubscribed from all email." : "Done — that one's off.",
    detail:
      "You can change this any time at /notifications?view=preferences. In-app notifications stay on.",
  });
}

function renderResult(opts: {
  method: string;
  ok: boolean;
  headline: string;
  detail: string;
}): Response {
  // One-Click POST per RFC 8058 expects a 200 (any 2xx) with no body
  // required. We send 204 to keep noise out of mail-server logs.
  if (opts.method === "POST") return new Response(null, { status: 204 });

  // Minimal hand-rolled HTML — this route runs outside any React tree
  // and we don't want to drag a renderer in for a confirmation page.
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Unsubscribed — Brackeys</title>
<style>
  body { background:#0a0a0a; color:#f5f5f5; font-family: monospace; display:flex; min-height:100dvh; align-items:center; justify-content:center; padding:24px; margin:0; }
  .card { max-width: 420px; }
  h1 { font-size: 14px; font-weight:700; letter-spacing:0.2em; text-transform:uppercase; margin:0 0 12px; }
  p { font-size: 13px; color:#d0d0d0; margin:8px 0; line-height: 1.5; }
  a { color:#ff007f; }
</style></head><body><div class="card">
  <h1>${escapeHtml(opts.headline)}</h1>
  <p>${escapeHtml(opts.detail)}</p>
  <p><a href="/notifications?view=preferences">Manage preferences</a> · <a href="/">Back to Brackeys</a></p>
</div></body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // No-store: harmless and stops aggressive proxy caches from
      // serving stale confirmation pages with someone else's token in
      // the referrer chain.
      "Cache-Control": "no-store",
    },
  });
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

export const Route = createFileRoute("/api/notifications/unsub")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
    },
  },
});
