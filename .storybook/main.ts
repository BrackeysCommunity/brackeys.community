import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: ["@chromatic-com/storybook"],
  framework: {
    name: "@storybook/react-vite",
    options: {
      builder: {
        // Use a dedicated minimal Vite config for Storybook so the root
        // vite.config.ts (nitro/tanstack-start/sentry) doesn't hijack the
        // preview build and redirect assets to .output/public/.
        viteConfigPath: ".storybook/vite.config.ts",
      },
    },
  },
};
export default config;
