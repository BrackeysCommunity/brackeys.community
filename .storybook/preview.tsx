import type { Preview } from "@storybook/react-vite";

import { Cursor } from "../src/components/ui/cursor";

// @ts-ignore
import "../src/styles.css";
// @ts-ignore
import "../src/fonts.css";

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
  decorators: [
    (Story) => {
      document.documentElement.classList.add("dark");
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
