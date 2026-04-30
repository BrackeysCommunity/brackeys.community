import type { Meta, StoryObj } from "@storybook/react";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";

import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Heading, Text } from "@/components/ui/typography";

function withMockRouter(ui: React.ReactNode, initialPath = "/") {
  const rootRoute = createRootRoute({ component: () => <>{ui}</> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  return <RouterProvider router={router} />;
}

const meta: Meta<typeof MobileBottomNav> = {
  title: "Layout/MobileBottomNav",
  component: MobileBottomNav,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="flex min-h-[420px] w-[420px] flex-col items-stretch justify-end bg-background p-6">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof MobileBottomNav>;

export const Overview: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div>
        <Heading as="h2" size="sm" monospace>
          Mobile bottom nav
        </Heading>
        <Text as="p" size="xs" variant="muted" className="mt-2 max-w-md">
          Five-cell button-group island that sits above the iOS home indicator on touch devices.
          Order is <em>Home · Jams · Collab · Me · Themes</em>; the middle cell (Collab) is the
          primary action and renders with the primary Chonk variant.
        </Text>
      </div>
      {withMockRouter(<MobileBottomNav inline pathnameOverride="/" />)}
    </div>
  ),
};

export const ActiveStates: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <Heading as="h3" size="xs" monospace>
        On Home
      </Heading>
      {withMockRouter(<MobileBottomNav inline pathnameOverride="/" />)}

      <Heading as="h3" size="xs" monospace>
        On Collab (middle / primary)
      </Heading>
      {withMockRouter(<MobileBottomNav inline pathnameOverride="/collab" />, "/collab")}

      <Heading as="h3" size="xs" monospace>
        On Profile
      </Heading>
      {withMockRouter(<MobileBottomNav inline pathnameOverride="/profile" />, "/profile")}
    </div>
  ),
};

export const Floating: Story = {
  render: () => (
    <div className="relative h-[600px] w-full overflow-hidden border border-muted">
      <div className="p-4 font-mono text-xs text-muted-foreground">
        ▼ Fixed-positioned variant. Sits at the bottom of the viewport with safe-area padding.
      </div>
      {withMockRouter(<MobileBottomNav />)}
    </div>
  ),
};
