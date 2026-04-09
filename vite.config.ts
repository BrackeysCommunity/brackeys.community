import { fileURLToPath, URL } from "node:url";

import babel from "@rolldown/plugin-babel";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import wasm from "vite-plugin-wasm";
import { defineConfig } from "vite-plus";

import pkg from "./package.json" with { type: "json" };

const config = defineConfig({
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
    ],
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
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
      traceDeps: ["react", "react-dom"],
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
