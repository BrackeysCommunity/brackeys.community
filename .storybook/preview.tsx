import type { Preview } from "@storybook/react-vite";

import { Cursor } from "../src/components/ui/cursor";
import { themes, DEFAULT_THEME_ID } from "../src/lib/themes";

// @ts-ignore
import "../src/styles.css";
// @ts-ignore
import "../src/fonts.css";

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "App color theme",
      toolbar: {
        title: "Theme",
        icon: "paintbrush",
        items: themes.map((t) => ({ value: t.id, title: t.name })),
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: DEFAULT_THEME_ID,
  },
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme || DEFAULT_THEME_ID;
      document.documentElement.classList.add("dark");
      document.documentElement.setAttribute("data-theme", theme);
      return (
        <>
          <Cursor />
          <Story />
        </>
      );
    },
  ],
};

export default preview;
