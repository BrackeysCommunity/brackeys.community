import { defineConfig } from "vitest/config"
import { fileURLToPath, URL } from "node:url"
import wasm from "vite-plugin-wasm"
import topLevelAwait from "vite-plugin-top-level-await"

export default defineConfig({
	plugins: [wasm(), topLevelAwait()],
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
})
