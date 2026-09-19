import { toast } from "@/lib/toast";

/**
 * Discord's desktop client registers the `discord://` scheme and mounts the
 * same `/oauth2/authorize` route the website serves. Sending the authorize
 * URL there runs the consent screen against the account the *app* is signed
 * into, rather than whatever discord.com session the browser happens to
 * hold. The two differ for anyone running an alt in one of them, and a
 * member who lives in the app expects the site to sign in as that account.
 *
 * The approval itself still lands back in a browser: the client opens
 * `redirect_uri` in the system default browser, which must be the one that
 * started the flow, since better-auth binds the callback to a signed
 * `state` cookie set at the start (`account.skipStateCookieCheck` is the
 * escape hatch, at the cost of login-CSRF protection).
 */

const DISCORD_AUTHORIZE_HOSTS = new Set([
  "discord.com",
  "discordapp.com",
  "canary.discord.com",
  "ptb.discord.com",
]);

/**
 * Rewrite a web authorize URL to the desktop client's deep-link form.
 * Anything that isn't a Discord authorize URL returns null, so a caller
 * never deep-links some other provider by accident.
 */
export function toDiscordAppAuthorizeUrl(webUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(webUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !DISCORD_AUTHORIZE_HOSTS.has(url.hostname)) return null;
  const path = url.pathname.replace(/^\/api(\/v\d+)?/, "");
  if (path !== "/oauth2/authorize") return null;
  return `discord://-/oauth2/authorize${url.search}`;
}

/**
 * Hand the authorize URL to the desktop client. A browser navigating to an
 * unregistered scheme does nothing observable, and the "Open Discord?"
 * prompt some browsers show holds focus long enough that any timed fallback
 * races the person — so the web route is offered, never assumed.
 */
export function openDiscordAuthorize(webUrl: string): void {
  const appUrl = toDiscordAppAuthorizeUrl(webUrl);
  if (!appUrl) {
    window.location.assign(webUrl);
    return;
  }
  const id = toast("Continue in the Discord app", {
    description: "Nothing happened? Use the browser instead.",
    duration: Infinity,
    action: { label: "Use browser", onClick: () => window.location.assign(webUrl) },
  });
  window.addEventListener(
    "blur",
    () => toast("Handed off to the Discord app", { id, duration: 8000, action: undefined }),
    { once: true },
  );
  window.location.assign(appUrl);
}
