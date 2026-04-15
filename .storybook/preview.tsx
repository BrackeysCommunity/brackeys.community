import type { Preview } from "@storybook/react-vite";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { useMemo } from "react";

import { Cursor } from "../src/components/ui/cursor";
import { themes, DEFAULT_THEME_ID } from "../src/lib/themes";

// @ts-ignore
import "../src/styles.css";
// @ts-ignore
import "../src/fonts.css";

function StorybookRouter({ children }: { children: React.ReactNode }) {
  const router = useMemo(() => {
    const rootRoute = createRootRoute({ component: () => children });
    return createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
  }, [children]);

  // @ts-expect-error -- minimal router for storybook, not the app's typed router
  return <RouterProvider router={router} />;
}

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
        <StorybookRouter>
          <Cursor />
          <Story />
        </StorybookRouter>
      );
    },
  ],
};

export default preview;
