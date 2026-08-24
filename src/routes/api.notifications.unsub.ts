import "@/polyfill";
import { createFileRoute } from "@tanstack/react-router";

import { db } from "@/db";
import { ACCENT, ACCENT_TEXT, BG, FG, FONT_MONO, FONT_SANS, MUTED } from "@/emails/theme";
import { EVENTS } from "@/lib/event-taxonomy";
import { NOTIFICATION_TYPE_LABEL } from "@/lib/notification-copy";
import { captureServerEvent, withErrorReporting } from "@/lib/posthog-server";
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
 *   - The unsubscribe links inside the email body — humans GET it.
 *
 * GET never mutates: corporate link scanners (Proofpoint, Safe Links…)
 * fetch every URL in an inbound message, and each fetch of a mutating GET
 * is a silent unsubscribe the recipient never sees. So GET renders a
 * confirmation form and only POST flips prefs — the RFC 8058 one-click
 * path was already a POST and is unaffected. Both shapes accept
 * `?token=...&type=...` where the type is optional; missing type means
 * "all email off."
 *
 * Auth-free by design — the token *is* the authorization. We respond
 * 200 even on an unknown token so harvesters can't probe.
 */
async function handle({ request }: { request: Request }) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const typeParam = url.searchParams.get("type");
  const scope = typeParam && isKnownNotificationType(typeParam) ? typeParam : ("all" as const);
  const scopeLabel = scope === "all" ? null : NOTIFICATION_TYPE_LABEL[scope];

  if (request.method === "GET") {
    // Same page for a valid and an unknown token — validity leaks nothing.
    return renderPage({
      headline: scope === "all" ? "Unsubscribe from all email?" : "Stop emails like this?",
      detail: scopeLabel
        ? `This turns off "${scopeLabel}" emails, including the weekly digest for it. In-app notifications stay on.`
        : "This stops every notification and digest email. Account and security mail still comes through, and in-app notifications stay on.",
      form: { action: url.pathname + url.search, cta: "Unsubscribe" },
    });
  }

  const userId = await resolveUnsubscribeToken(db, token);
  if (userId) {
    await applyUnsubscribe(db, userId, scope);
    if (scope === "all") {
      captureServerEvent(EVENTS.notificationEmailsDisabled, userId, {
        disabled: true,
        via: "email_link",
      });
    } else {
      captureServerEvent(EVENTS.notificationPrefChanged, userId, {
        type: scope,
        channel: "email",
        enabled: false,
        via: "email_link",
      });
    }
  }

  // Our confirmation form marks itself with `confirm=1`; an RFC 8058
  // one-click POST carries `List-Unsubscribe=One-Click` instead and wants
  // a bare 2xx — 204 keeps noise out of mail-server logs.
  const fromForm = await isConfirmForm(request);
  if (!fromForm) return new Response(null, { status: 204 });

  return renderPage({
    headline: scope === "all" ? "You're unsubscribed from all email." : "Done — that one's off.",
    detail:
      "You can change this any time in your notification settings. In-app notifications stay on.",
  });
}

async function isConfirmForm(request: Request): Promise<boolean> {
  try {
    const form = await request.formData();
    return form.get("confirm") === "1";
  } catch {
    return false;
  }
}

function renderPage(opts: {
  headline: string;
  detail: string;
  form?: { action: string; cta: string };
}): Response {
  // Minimal hand-rolled HTML — this route runs outside any React tree and
  // we don't want to drag a renderer in for a confirmation page. The
  // palette and type come from the shared email theme so this page can't
  // drift from the mail that linked to it.
  const formHtml = opts.form
    ? `<form method="post" action="${escapeHtml(opts.form.action)}">
    <input type="hidden" name="confirm" value="1" />
    <button type="submit">${escapeHtml(opts.form.cta)}</button>
  </form>`
    : `<p><a href="/settings?tab=notifications">Manage preferences</a> · <a href="/">Back to Brackeys</a></p>`;

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Unsubscribe — Brackeys</title>
<style>
  body { background:${BG}; color:${FG}; font-family:${FONT_SANS}; display:flex; min-height:100dvh; align-items:center; justify-content:center; padding:24px; margin:0; }
  .card { max-width: 420px; }
  h1 { font-family:${FONT_MONO}; font-size: 12px; font-weight:700; letter-spacing:0.2em; text-transform:uppercase; margin:0 0 12px; }
  p { font-size: 14px; color:${MUTED}; margin:8px 0; line-height: 1.6; }
  a { color:${ACCENT_TEXT}; }
  button { background:${ACCENT}; color:#fff; font-family:${FONT_SANS}; font-size:14px; font-weight:700; padding:10px 22px; border:0; border-radius:8px; cursor:pointer; margin-top:12px; }
</style></head><body><div class="card">
  <h1>${escapeHtml(opts.headline)}</h1>
  <p>${escapeHtml(opts.detail)}</p>
  ${formHtml}
</div></body></html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // No-store: harmless and stops aggressive proxy caches from
      // serving stale confirmation pages with someone else's token.
      "Cache-Control": "no-store",
      // The URL carries a bearer token with no expiry; never let it ride
      // out on the links to settings or home.
      "Referrer-Policy": "no-referrer",
    },
  });
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/** Reports an unhandled throw before it becomes an opaque 500. */
const reportedHandle = withErrorReporting("/api/notifications/unsub", handle);

export const Route = createFileRoute("/api/notifications/unsub")({
  server: {
    handlers: {
      GET: reportedHandle,
      POST: reportedHandle,
    },
  },
});
