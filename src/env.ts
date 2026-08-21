import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    SERVER_URL: z.url().optional(),
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
    // 32 bytes base64 — seals linked_accounts.access_token at rest (see
    // src/lib/token-crypto.ts, which reads process.env directly so the
    // sync service can share it; declared here for visibility/validation).
    LINKED_ACCOUNTS_ENC_KEY: z.string().min(1).optional(),
    MINIO_BUCKET: z.string().min(1).optional(),
    MINIO_ENDPOINT: z.string().min(1).optional(),
    MINIO_ACCESS_KEY: z.string().min(1).optional(),
    MINIO_SECRET_KEY: z.string().min(1).optional(),
    // Email (Resend). Read via process.env in src/lib/email.ts so the
    // notifications worker can share that module; declared here for
    // visibility/validation. DISABLE_EMAIL=1 short-circuits every send —
    // the documented local default, so a dev machine with a real key in
    // its environment can't mail real users from `vp dev`.
    RESEND_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(1).optional(),
    DISABLE_EMAIL: z.string().optional(),
    // Public origin fallback for server-side URL minting (`siteOrigin()`).
    APP_URL: z.url().optional(),
  },

  /**
   * The prefix that client-side variables must have. This is enforced both at
   * a type-level and at runtime.
   */
  clientPrefix: "VITE_",

  client: {
    VITE_APP_TITLE: z.string().min(1).optional(),
    // Any non-empty value routes itch-hosted images through Cloudflare Image
    // Transformations (src/lib/itch-image.ts). Set only on deploys served
    // through the brackeys.community zone with transformations enabled;
    // locally /cdn-cgi/ doesn't exist and images hotlink itch directly.
    VITE_CF_IMAGES: z.string().min(1).optional(),
    VITE_ITCHIO_CLIENT_ID: z.string().min(1).optional(),
    VITE_OAUTH_PROXY_ORIGIN: z.string().min(1).optional(),
    // PostHog project API key — public by design (it can only write events).
    // Absent means analytics is off entirely: nothing initialises, every
    // capture is a no-op, and `useFlag` falls back to the defaults declared
    // in `src/lib/flags.ts`.
    VITE_POSTHOG_KEY: z.string().min(1).optional(),
    // Ingestion host. EU cloud is `https://eu.i.posthog.com`; point it at the
    // reverse proxy once one exists and set `ui_host` alongside it.
    VITE_POSTHOG_HOST: z.url().optional(),
    // Read through `siteOrigin()` below, never directly.
    VITE_SITE_ORIGIN: z.url().optional(),
  },

  /**
   * What object holds the environment variables at runtime. This is usually
   * `process.env` or `import.meta.env`.
   */
  runtimeEnv: {
    ...(typeof process !== "undefined" ? process.env : {}),
    ...import.meta.env,
  },

  /**
   * By default, this library will feed the environment variables directly to
   * the Zod validator.
   *
   * This means that if you have an empty string for a value that is supposed
   * to be a number (e.g. `PORT=` in a ".env" file), Zod will incorrectly flag
   * it as a type mismatch violation. Additionally, if you have an empty string
   * for a value that is supposed to be a string with a default value (e.g.
   * `DOMAIN=` in an ".env" file), the default value will never be applied.
   *
   * In order to solve these issues, we recommend that all new projects
   * explicitly specify this option as true.
   */
  emptyStringAsUndefined: true,
});

/**
 * The origin this deployment serves from, without a trailing slash. Must be
 * a constant, not `window.location`: `head()` runs on both sides of the
 * hydration boundary.
 */
export function siteOrigin(): string {
  const raw =
    env.VITE_SITE_ORIGIN ??
    (typeof process !== "undefined" ? process.env.APP_URL : undefined) ??
    "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

export function siteUrl(pathOrUrl: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(pathOrUrl) || pathOrUrl.startsWith("//")) return pathOrUrl;
  return `${siteOrigin()}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}
