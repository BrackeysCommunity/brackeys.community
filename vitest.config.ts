import { defineConfig } from "vite-plus";
import { fileURLToPath, URL } from "node:url";
import wasm from "vite-plugin-wasm";

export default defineConfig({
  plugins: [wasm()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@dimforge/rapier2d": fileURLToPath(
        new URL("./node_modules/@dimforge/rapier2d/rapier.js", import.meta.url),
      ),
    },
  },
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    environment: "node",
  },
});
