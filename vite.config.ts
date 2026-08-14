import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";

import babel from "@rolldown/plugin-babel";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import wasm from "vite-plugin-wasm";
import { createLogger, defineConfig } from "vite-plus";

import pkg from "./package.json" with { type: "json" };

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
      traceDeps: ["react", "react-dom", "@base-ui/react", "@babel/runtime"],
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
        "/api/public/**": { headers: { "cache-control": "public, max-age=30, s-maxage=60" } },
        // Taxonomies change when a moderator edits the vocabulary — rare
        // enough for a day at the edge.
        "/api/public/rpc/listSkills": {
          headers: { "cache-control": "public, max-age=3600, s-maxage=86400" },
        },
        "/api/public/rpc/listCollabRoles": {
          headers: { "cache-control": "public, max-age=3600, s-maxage=86400" },
        },
        // A live GitHub GraphQL call per request otherwise; the calendar
        // only moves once a day anyway.
        "/api/public/rpc/getContributions": {
          headers: { "cache-control": "public, max-age=300, s-maxage=900" },
        },
        // The board is the one public read users actively write to, and
        // creating or editing a post invalidates the listing query
        // client-side. max-age=0 keeps the *browser* out of it, so that
        // refetch always leaves the machine instead of being answered from
        // the local HTTP cache with the pre-write body; the edge still
        // absorbs the load for everyone else.
        "/api/public/rpc/listPosts": {
          headers: { "cache-control": "public, max-age=0, s-maxage=30" },
        },
        // Same reasoning as listPosts: responding to a post bumps its
        // response count, and the owner edits it in place.
        "/api/public/rpc/getPost": {
          headers: { "cache-control": "public, max-age=0, s-maxage=30" },
        },
        // Owners edit the team, manage the roster, and accept invites from
        // this page and expect to see the result.
        "/api/public/rpc/getTeam": {
          headers: { "cache-control": "public, max-age=0, s-maxage=30" },
        },
        // Members edit their own profile in place — same reasoning again.
        "/api/public/rpc/getProfile": {
          headers: { "cache-control": "public, max-age=0, s-maxage=30" },
        },
        // Editors change credits, covers and links from the page itself.
        "/api/public/rpc/getProject": {
          headers: { "cache-control": "public, max-age=0, s-maxage=30" },
        },
        // Stored-image proxy (src/routes/images.$.ts): keys are
        // nanoid-unique per upload and replacements mint a new key, so
        // responses are immutable. Deleted objects can outlive deletion at
        // the edge until evicted or purged (see docs/caching.md).
        "/images/**": { headers: { "cache-control": "public, max-age=31536000, immutable" } },
        // no-transform keeps proxies from buffering the event stream.
        "/api/notifications/stream": {
          headers: { "cache-control": "no-cache, no-transform" },
        },
        ...publicFileRules,
      },
    }),
    // https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md#react-compiler
    babel({
      presets: [reactCompilerPreset()],
    }),
    tailwindcss(),
    viteReact(),
  ].concat(
    // we don't want to mount Sentry outside of an actual build env because I don't want to pay for local errors
    process.env.NODE_ENV !== "production"
      ? []
      : [
          sentryTanstackStart({
            org: process.env.VITE_SENTRY_ORG,
            project: process.env.VITE_SENTRY_PROJECT,
            authToken: process.env.VITE_SENTRY_AUTH_TOKEN,
          }),
        ],
  ),
});

export default config;
