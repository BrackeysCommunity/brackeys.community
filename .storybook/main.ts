import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  "stories": [
    "../src/**/*.mdx",
    "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"
  ],
  "addons": [
    "@chromatic-com/storybook",
    "@storybook/addon-docs",
    "@storybook/addon-a11y",
    "@storybook/addon-vitest"
  ],
  "framework": {
    "name": "@storybook/react-vite",
    "options": {}
  },
  "viteFinal": async (config) => {
    // Only set base URL for GitHub Pages deployment, not for Chromatic
    if (process.env.GITHUB_PAGES === 'true') {
      config.base = '/brackeys.community/';
    }
    config.plugins = (config.plugins ?? []).filter((plugin) => plugin && 'name' in plugin && plugin.name !== 'vite:dts');
    return config;
  }
};
export default config;