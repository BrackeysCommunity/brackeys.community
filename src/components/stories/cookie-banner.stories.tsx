import type { Meta, StoryObj } from "@storybook/react";

import { CookieBanner } from "@/components/announcements/CookieBanner";

const noop = () => {};

const meta: Meta<typeof CookieBanner> = {
  title: "Components/CookieBanner",
  component: CookieBanner,
  parameters: { layout: "fullscreen" },
  args: { onDismiss: noop, onFollow: noop },
};

export default meta;
type Story = StoryObj<typeof CookieBanner>;

/** Flip the switch to see the copy follow the analytics preference. */
export const Default: Story = {
  render: (args) => (
    <div className="flex min-h-screen items-end bg-background p-6">
      <CookieBanner {...args} />
    </div>
  ),
};
