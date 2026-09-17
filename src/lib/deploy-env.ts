import { env, siteOrigin } from "@/env";
import { SITE } from "@/lib/legal-meta";

/**
 * Which deployment the running bundle belongs to, for the one surface that
 * has to say so out loud: the staging marker.
 *
 * Derived from `siteOrigin()` rather than Railway's `RAILWAY_ENVIRONMENT_NAME`
 * (what `posthog-server.ts` reads) because that variable is server-only and
 * the marker is a component — the origin is a build-time constant that both
 * sides of the hydration boundary already agree on. `VITE_DEPLOY_ENV`
 * overrides it for a deploy whose origin doesn't tell the truth, e.g. a
 * production-domain rehearsal.
 */
export type DeployEnv = "production" | "staging" | "development";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** True for the canonical production host and its `www.` form only. */
function isProductionHost(host: string): boolean {
  return host === SITE.domain || host === `www.${SITE.domain}`;
}

export function deployEnvFromOrigin(origin: string): DeployEnv {
  const host = hostOf(origin);
  // An unparseable origin is a misconfiguration, and the safe reading of a
  // misconfiguration is "not production" — a stray badge costs nothing, a
  // missing one is the whole bug this fixes.
  if (!host) return "staging";
  if (isProductionHost(host)) return "production";
  if (LOCAL_HOSTS.has(host) || host.endsWith(".localhost")) return "development";
  return "staging";
}

export function deployEnv(): DeployEnv {
  return env.VITE_DEPLOY_ENV ?? deployEnvFromOrigin(siteOrigin());
}

/**
 * What the marker says, or null on production — the one environment that
 * shows nothing. Short on purpose: it rides beside the logo.
 */
export function deployEnvLabel(): string | null {
  switch (deployEnv()) {
    case "production":
      return null;
    case "staging":
      return "STAGING";
    case "development":
      return "LOCAL";
  }
}
