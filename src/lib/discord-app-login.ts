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
 * The callback URL carries this so the tab the desktop client opens knows
 * it is the far side of an app handoff, not an ordinary page load.
 */
const RETURN_PARAM = "signin";
const RETURN_VALUE = "discord_app";

/** localStorage key the landing tab writes; `storage` fires in every other tab. */
const SIGNIN_KEY = "discord-app-signin";

/**
 * Which route this browser is known to complete. Nothing tells a page
 * whether a scheme has a handler, so the answer is learned once: a
 * completed app sign-in records "app", pressing "Use browser" records
 * "web", and either way the extra step is paid at most once per browser.
 */
const ROUTE_KEY = "discord-signin-route";

export type SigninRoute = "app" | "web";

export function rememberedSigninRoute(): SigninRoute | null {
  try {
    const value = localStorage.getItem(ROUTE_KEY);
    return value === "app" || value === "web" ? value : null;
  } catch {
    return null;
  }
}

export function rememberSigninRoute(route: SigninRoute): void {
  try {
    localStorage.setItem(ROUTE_KEY, route);
  } catch {
    // Storage blocked: the route is decided fresh each time.
  }
}

export function withDiscordAppReturn(callbackURL: string): string {
  const [path, search = ""] = callbackURL.split("?", 2);
  const params = new URLSearchParams(search);
  params.set(RETURN_PARAM, RETURN_VALUE);
  return `${path}?${params.toString()}`;
}

/** The marker's presence, and the URL with it removed. */
export function readDiscordAppReturn(href: string): { returned: boolean; href: string } {
  const url = new URL(href);
  if (url.searchParams.get(RETURN_PARAM) !== RETURN_VALUE) return { returned: false, href };
  url.searchParams.delete(RETURN_PARAM);
  return { returned: true, href: url.pathname + url.search + url.hash };
}

/** Landing-tab side: this browser has now completed the app route. */
export function announceDiscordAppSignin(): void {
  rememberSigninRoute("app");
  try {
    localStorage.setItem(SIGNIN_KEY, String(Date.now()));
  } catch {
    // Storage blocked: the other tab catches up on its next reload.
  }
}

/** Runs `onSignin` when another tab announces; returns the unsubscribe. */
export function onDiscordAppSignin(onSignin: () => void): () => void {
  const listener = (event: StorageEvent) => {
    if (event.key === SIGNIN_KEY && event.newValue) onSignin();
  };
  window.addEventListener("storage", listener);
  return () => window.removeEventListener("storage", listener);
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
    action: {
      label: "Use browser",
      onClick: () => {
        rememberSigninRoute("web");
        window.location.assign(webUrl);
      },
    },
  });
  window.addEventListener(
    "blur",
    () => toast("Handed off to the Discord app", { id, duration: Infinity, action: undefined }),
    { once: true },
  );
  const stop = onDiscordAppSignin(() => {
    stop();
    toast.success("Signed in", { id, duration: 4000, description: undefined, action: undefined });
  });
  window.location.assign(appUrl);
}
