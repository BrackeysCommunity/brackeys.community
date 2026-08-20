import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";

import posthogRollupPlugin from "@posthog/rollup-plugin";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import type { Plugin as RolldownPlugin } from "rollup";
import wasm from "vite-plugin-wasm";
import { createLogger, defineConfig } from "vite-plus";

import pkg from "./package.json" with { type: "json" };
import { publicCacheRouteRules } from "./src/orpc/public-procedures.ts";

// The counter comes from package.json, bumped by the `version-bump` GitLab job
// on every merge to main, so it is committed and therefore present in every
// build — Railpack unpacks a snapshot with no .git dir, so nothing derived from
// git can be relied on here.
//
// The commit is a best-effort suffix on top: it pins the exact build when the
// builder knows it. Env first, since a snapshot build has the vars but not the
// repo, and `railway up` has neither.
const resolveCommitSha = () => {
  const fromEnv =
    process.env.APP_COMMIT_SHA ?? process.env.CI_COMMIT_SHA ?? process.env.RAILWAY_GIT_COMMIT_SHA;
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

const commitSha = resolveCommitSha();
const appVersion = commitSha ? `${pkg.version}+${commitSha}` : pkg.version;

// Source-map upload is keyed off the credential being present, never off
// NODE_ENV — MR previews build as `staging`, and the old Sentry gate on
// `NODE_ENV === "production"` silently excluded them for exactly that reason.
// A build without the key is a normal build with no maps.
const posthogPersonalApiKey = process.env.POSTHOG_PERSONAL_API_KEY;
const posthogSourcemapsEnabled = Boolean(posthogPersonalApiKey);

/**
 * Hardens the PostHog source-map plugin against two behaviours that are
 * both wrong for a deploy pipeline. Verified against @posthog/rollup-plugin
 * 1.4.9 by building with an unreachable host:
 *
 *  1. **A failed upload fails the build.** An expired key or a PostHog
 *     outage would stop a deploy — un-minified stack traces are a debugging
 *     nicety and must never be able to do that. Downgraded to a warning.
 *  2. **A failed upload leaves the `.map` files behind.** `deleteAfterUpload`
 *     only runs on the success path, so a failed build left 215 maps in
 *     `.output/public/assets`, where they would be deployed and served —
 *     publishing the app's source. The sweep below runs either way.
 *
 * Recheck both if the plugin is upgraded; if it grows a "don't fail the
 * build" option and cleans up on failure, this wrapper can go.
 */
function resilientSourcemapUpload(plugin: RolldownPlugin): RolldownPlugin {
  const hook = plugin.writeBundle;
  if (typeof hook !== "object" || typeof hook.handler !== "function") {
    throw new Error(
      "@posthog/rollup-plugin no longer exposes writeBundle as an object hook — re-check resilientSourcemapUpload.",
    );
  }
  const original = hook.handler;

  return {
    ...plugin,
    writeBundle: {
      ...hook,
      async handler(this: unknown, options: { dir?: string }, bundle: unknown) {
        try {
          await (original as (...args: unknown[]) => unknown).call(this, options, bundle);
        } catch (error) {
          console.warn(
            "[posthog] source-map upload failed; the build continues without un-minified stacks.",
            error,
          );
        } finally {
          if (options.dir) await removeSourceMaps(options.dir);
        }
      },
    },
  } as RolldownPlugin;
}

/** Belt-and-braces: a `.map` reaching the CDN publishes the source. */
async function removeSourceMaps(dir: string) {
  const { readdir, rm } = await import("node:fs/promises");
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".map"))
      .map((entry) => rm(join(entry.parentPath, entry.name), { force: true })),
  );
}

// Unhashed files in public/ are served at the site root, so nothing busts
// their URLs on deploy: give browsers a day and let Cloudflare hold them at
// the edge (purge the zone cache if one is ever swapped in place).
const publicDir = fileURLToPath(new URL("./public", import.meta.url));
const publicFileRules = Object.fromEntries(
  readdirSync(publicDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => [
      `/${relative(publicDir, join(entry.parentPath, entry.name)).split(sep).join("/")}`,
      { headers: { "cache-control": "public, max-age=86400, stale-while-revalidate=604800" } },
    ]),
);

// Filter noisy "Failed to load source map" warnings from @tanstack/* packages
// which ship sourceMappingURL comments without the .map files.
const logger = createLogger();
const shouldFilter = (msg: string) =>
  msg.includes("Failed to load source map") && msg.includes("/@tanstack/");
const originalWarn = logger.warn;
const originalWarnOnce = logger.warnOnce;
logger.warn = (msg, options) => {
  if (shouldFilter(msg)) return;
  originalWarn(msg, options);
};
logger.warnOnce = (msg, options) => {
  if (shouldFilter(msg)) return;
  originalWarnOnce(msg, options);
};

const config = defineConfig({
  customLogger: logger,
  staged: {
    "*": "vp check --fix",
  },

  run: {
    cache: {
      // Disabled since Vite+ only replays terminal output, not build artifacts.
      // Enable if your platform preserves build outputs between deployments.
      // see: https://github.com/mugnavo/tanstarter-plus/issues/8
      tasks: false,
    },
  },

  // Oxfmt - https://oxc.rs/docs/guide/usage/formatter/config.html
  fmt: {
    tabWidth: 2,
    semi: true,
    printWidth: 100,
    singleQuote: false,
    endOfLine: "lf",
    trailingComma: "all",
    sortImports: {},
    sortTailwindcss: {
      stylesheet: "./src/styles.css",
      attributes: ["class", "className"],
      functions: ["clsx", "cn", "cva", "tw"],
    },
    sortPackageJson: true,
    ignorePatterns: [
      "bun.lock",
      "routeTree.gen.ts",
      ".tanstack-start/",
      ".tanstack/",
      "drizzle/",
      ".drizzle/",
      ".cache",
      ".output",
      "dist",
    ],
  },

  // Oxlint - https://oxc.rs/docs/guide/usage/linter/config
  lint: {
    plugins: ["typescript", "react", "react-perf", "jsx-a11y"],
    env: {
      builtin: true,
      node: true,
      browser: true,
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      { name: "react-hooks-js", specifier: "eslint-plugin-react-hooks" },
      // Plugins with "/" in name have to be aliased for now
      // Issue: https://github.com/oxc-project/oxc/issues/14557
      {
        name: "eslint-tanstack-router",
        specifier: "@tanstack/eslint-plugin-router",
      },
      {
        name: "eslint-tanstack-query",
        specifier: "@tanstack/eslint-plugin-query",
      },
    ],
    rules: {
      "no-deprecated": "warn",
      "typescript/no-floating-promises": "off",
      "typescript/no-misused-spread": "off",

      "eslint-tanstack-router/create-route-property-order": "warn",

      "eslint-tanstack-query/exhaustive-deps": "warn",
      "eslint-tanstack-query/stable-query-client": "warn",
      "eslint-tanstack-query/no-rest-destructuring": "warn",
      "eslint-tanstack-query/no-unstable-deps": "warn",
      "eslint-tanstack-query/infinite-query-property-order": "warn",
      "eslint-tanstack-query/no-void-query-fn": "warn",
      "eslint-tanstack-query/mutation-property-order": "warn",

      // ref: https://github.com/TheAlexLichter/oxlint-react-compiler-rules/issues/1
      // Recommended rules (from LintRulePreset.Recommended)
      "react-hooks-js/component-hook-factories": "error",
      "react-hooks-js/config": "error",
      "react-hooks-js/error-boundaries": "error",
      "react-hooks-js/gating": "error",
      "react-hooks-js/globals": "error",
      "react-hooks-js/immutability": "error",
      "react-hooks-js/incompatible-library": "warn",
      "react-hooks-js/preserve-manual-memoization": "error",
      "react-hooks-js/purity": "error",
      "react-hooks-js/refs": "error",
      "react-hooks-js/set-state-in-effect": "warn",
      "react-hooks-js/set-state-in-render": "error",
      "react-hooks-js/static-components": "error",
      "react-hooks-js/unsupported-syntax": "error",
      "react-hooks-js/use-memo": "error",
      // Recommended-latest rules (from LintRulePreset.RecommendedLatest)
      "react-hooks-js/void-use-memo": "error",
      // Off rules (LintRulePreset.Off) - not enabled by default
      "react-hooks-js/automatic-effect-dependencies": "off",
      "react-hooks-js/capitalized-calls": "off",
      "react-hooks-js/fbt": "off",
      "react-hooks-js/fire": "off",
      "react-hooks-js/hooks": "off",
      "react-hooks-js/invariant": "off",
      "react-hooks-js/memoized-effect-dependencies": "off",
      "react-hooks-js/no-deriving-state-in-effects": "off",
      "react-hooks-js/rule-suppression": "off",
      "react-hooks-js/syntax": "off",
      "react-hooks-js/todo": "off",
    },
    ignorePatterns: [
      "dist",
      ".wrangler",
      ".vercel",
      ".netlify",
      ".output",
      "build/",
      "worker-configuration.d.ts",
      "scripts/",
      "services/",
    ],
  },
  // "hidden" emits the maps without a `//# sourceMappingURL` comment: the
  // upload below needs them, browsers must not fetch them, and the plugin
  // deletes them after upload so they never reach the CDN either way.
  build: {
    sourcemap: posthogSourcemapsEnabled ? "hidden" : false,
  },
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  plugins: [
    wasm(),
    devtools(),
    tanstackStart(),
    // https://tanstack.com/start/latest/docs/framework/react/guide/hosting
    nitro({
      // fixes SSR issues with Vite 8:
      // https://discord.com/channels/719702312431386674/1490005967067414608/1490634230458224751
      // `@resvg/resvg-wasm` stays external so the OG renderer can
      // `require.resolve` it at runtime.
      traceDeps: ["react", "react-dom", "@base-ui/react", "@babel/runtime", "@resvg/resvg-wasm"],
      hooks: {
        /**
         * Nitro's tracer follows JS imports, so it never sees the
         * `require.resolve` in `src/lib/og/render.ts` — and the binary can't
         * be bundled instead, since `vite-plugin-wasm` claims `.wasm` first.
         */
        async compiled(nitro: { options: { output: { serverDir: string } } }) {
          const { createRequire } = await import("node:module");
          const { copyFile, mkdir } = await import("node:fs/promises");
          const source = createRequire(import.meta.url).resolve("@resvg/resvg-wasm/index_bg.wasm");
          const target = join(
            nitro.options.output.serverDir,
            "node_modules/@resvg/resvg-wasm/index_bg.wasm",
          );
          await mkdir(dirname(target), { recursive: true });
          await copyFile(source, target);
        },
      },
      rolldownConfig: {
        external: ["tslib"],
      },
      // Origin cache policy; Cloudflare respects these for edge TTLs. Beware
      // two sharp edges: header rules OVERRIDE handler-set response headers
      // (h3 merges rule headers last), and overlapping patterns merge with
      // the most specific pattern winning — which is why the SSE stream
      // restates its own contract below.
      routeRules: {
        // SSR documents embed the viewer's session: never shared-cacheable.
        // no-cache (vs no-store) still lets the browser keep a revalidatable
        // copy and use bfcache.
        "/**": { headers: { "cache-control": "private, no-cache" } },
        // Content-hashed client bundles; restates nitro's default so the
        // fallback above can never regress it.
        "/assets/**": { headers: { "cache-control": "public, max-age=31536000, immutable" } },
        "/api/**": { headers: { "cache-control": "no-store" } },
        // The public RPC tier (src/routes/api.public.rpc.$.ts): served with
        // no cookies read and identical output for every caller, so it is
        // the one /api subtree that is shared-cacheable.
        //
        // The catch-all stays `no-store` so caching is opt-in per procedure:
        // a public read that ships before someone picks its staleness budget
        // is merely uncached, never cached for a duration nobody chose.
        "/api/public/**": { headers: { "cache-control": "no-store" } },
        // …and the per-procedure rules, generated from the TTL table so this
        // file cannot drift from it. All `max-age=0`: the edge does the
        // caching, the browser always revalidates.
        ...publicCacheRouteRules(),
        // Stored-image proxy (src/routes/images.$.ts): keys are
        // nanoid-unique per upload and replacements mint a new key, so
        // responses are immutable. Deleted objects can outlive deletion at
        // the edge until evicted or purged (see docs/caching.md).
        "/images/**": { headers: { "cache-control": "public, max-age=31536000, immutable" } },
        // no-transform keeps proxies from buffering the event stream.
        "/api/notifications/stream": {
          headers: { "cache-control": "no-cache, no-transform" },
        },
        // Identical for every caller; let Cloudflare answer repeat crawls.
        "/sitemap.xml": { headers: { "cache-control": "public, max-age=0, s-maxage=3600" } },
        "/robots.txt": { headers: { "cache-control": "public, max-age=0, s-maxage=3600" } },
        "/feed.xml": { headers: { "cache-control": "public, max-age=0, s-maxage=900" } },
        ...publicFileRules,
      },
    }),
    // https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md#react-compiler
    babel({
      presets: [reactCompilerPreset()],
    }),
    tailwindcss(),
    viteReact(),
    // Stamps each chunk with an id and uploads the matching map, so
    // PostHog error tracking can un-minify a stack. Without it exceptions
    // still arrive, just pointing into minified columns.
    ...(posthogSourcemapsEnabled
      ? [
          {
            ...resilientSourcemapUpload(
              posthogRollupPlugin({
                personalApiKey: posthogPersonalApiKey!,
                projectId: process.env.POSTHOG_PROJECT_ID,
                // The API/UI host (eu.posthog.com), NOT the ingestion host
                // (eu.i.posthog.com) that `POSTHOG_HOST` carries for the
                // services. Two different hosts; a shared variable under one
                // name would point uploads at the ingestion endpoint and fail.
                host: process.env.POSTHOG_API_HOST ?? "https://eu.posthog.com",
                sourcemaps: {
                  enabled: true,
                  releaseVersion: appVersion,
                  // The maps exist only to be uploaded; leaving them in
                  // .output would publish the app's source to the CDN.
                  deleteAfterUpload: true,
                },
              }),
            ),
            apply: "build" as const,
          },
        ]
      : []),
  ],
});

export default config;
