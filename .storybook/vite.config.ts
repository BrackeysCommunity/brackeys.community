// Dedicated Vite config for Storybook builds.
//
// The root vite.config.ts pulls in nitro(), tanstackStart(), and the Sentry
// TanStack Start plugins. Nitro in particular redirects the Vite build output
// to .output/public/, leaving storybook-static/ without iframe.html and the
// preview bundle — which makes Chromatic reject the build with "Invalid
// Storybook build". Keeping this config minimal avoids that.

import { fileURLToPath, URL } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import { defineConfig } from "vite-plus";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@": fileURLToPath(new URL("../src", import.meta.url)),
    },
  },
  plugins: [wasm(), viteReact(), tailwindcss()],
});
