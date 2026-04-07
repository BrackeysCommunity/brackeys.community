import { defineConfig } from "vite-plus";
import { devtools } from "@tanstack/devtools-vite";
import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import wasm from "vite-plugin-wasm";
import pkg from "./package.json" with { type: "json" };

const config = defineConfig({
	staged: {
		"*": "vp check --fix",
	},
	fmt: {
		useTabs: true,
		singleQuote: false,
		ignorePatterns: ["src/routeTree.gen.ts", "src/styles.css"],
	},
	lint: { options: { typeAware: true, typeCheck: true } },
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
		nitro({
			rollupConfig: { external: [/^@sentry\//, /^@dimforge\/rapier2d/, /^@radix-ui\//, /^ahooks/] },
		}),
		tailwindcss(),
		tanstackStart(),
		viteReact({
			babel: {
				plugins: ["babel-plugin-react-compiler"],
			},
		}),
	].concat(
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
