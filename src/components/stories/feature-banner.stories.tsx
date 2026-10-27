import {
  DashboardSquare02Icon,
  Notification01Icon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Meta, StoryObj } from "@storybook/react";
import { AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";

import { type Announcement, ANNOUNCEMENTS } from "@/components/announcements/announcements";
import { FeatureBanner } from "@/components/announcements/FeatureBanner";
import {
  hideSpotlight,
  showSpotlight,
  SPOTLIGHT_TARGETS,
  spotlightTarget,
} from "@/components/announcements/spotlight";
import { SpotlightOverlay } from "@/components/announcements/SpotlightOverlay";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/typography";

const launch = ANNOUNCEMENTS.find((a) => a.id === "canvases-launch")!;

/** The real entry, pointed at `/` — Storybook's router has no other route. */
const canvases: Announcement = { ...launch, cta: { ...launch.cta, link: { to: "/" } } };

const noop = () => {};

const meta: Meta<typeof FeatureBanner> = {
  title: "Components/FeatureBanner",
  component: FeatureBanner,
  parameters: { layout: "fullscreen" },
  args: { announcement: canvases, onDismiss: noop, onFollow: noop },
};

export default meta;
type Story = StoryObj<typeof FeatureBanner>;

export const Default: Story = {
  render: (args) => (
    <div className="flex min-h-screen items-end bg-background p-6">
      <FeatureBanner {...args} />
    </div>
  ),
};

export const WithoutEyebrow: Story = {
  ...Default,
  args: {
    announcement: {
      ...canvases,
      id: "plain",
      eyebrow: undefined,
      title: "Teams have a devlog",
      body: "Post progress updates to your team page and let followers keep up without joining the Discord.",
    },
  },
};

export const LongCopy: Story = {
  ...Default,
  args: {
    announcement: {
      ...canvases,
      id: "long",
      title: "A much longer announcement title that has to wrap onto a second line",
      body: "Banners are capped at max-w-sm, so long copy wraps rather than stretching across the page. Keep it to a sentence or two in practice — this is here to show the wrap, not to recommend it.",
    },
  },
};

/**
 * A stand-in for the header's control cluster, with the Workspace button
 * tagged as the spotlight target the real header uses.
 */
function FakeHeader() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 flex h-14 items-center justify-between border-b border-b-emboss-shadow bg-background px-6">
      <nav className="flex items-center gap-6 text-sm font-bold tracking-widest">
        <span className="text-primary">FORUM</span>
        <span>COLLAB</span>
        <span>JAMS</span>
        <span>TEAMS</span>
      </nav>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon-lg" aria-label="Settings">
          <HugeiconsIcon icon={Settings02Icon} size={16} />
        </Button>
        <Button
          variant="outline"
          size="icon-lg"
          aria-label="Open workspace"
          {...spotlightTarget(SPOTLIGHT_TARGETS.workspace)}
        >
          <HugeiconsIcon icon={DashboardSquare02Icon} size={16} />
        </Button>
        <Button variant="outline" size="icon-lg" aria-label="Notifications">
          <HugeiconsIcon icon={Notification01Icon} size={16} />
        </Button>
      </div>
    </header>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <FakeHeader />
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 pt-24">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-24 rounded-lg border border-border bg-card" />
        ))}
      </main>
      <div className="pointer-events-none fixed right-6 bottom-6 z-61 flex justify-end">
        {children}
      </div>
      <SpotlightOverlay />
    </div>
  );
}

/** Hover or focus the CTA: the page dims around the banner and the Workspace button. */
export const Spotlight: Story = {
  render: (args) => (
    <PageShell>
      <FeatureBanner {...args} />
    </PageShell>
  ),
};

/** The hovered state held on, for reviewing the dim, ring and sheen without a pointer. */
export const SpotlightHeld: Story = {
  render: function Render(args) {
    useEffect(() => {
      showSpotlight(SPOTLIGHT_TARGETS.workspace);
      return () => hideSpotlight(SPOTLIGHT_TARGETS.workspace);
    }, []);
    return (
      <PageShell>
        <FeatureBanner {...args} />
      </PageShell>
    );
  },
};

/** Dismiss or follow the CTA to see the exit; the banner comes back after a moment. */
export const DismissFlow: Story = {
  render: function Render(args) {
    const [open, setOpen] = useState(true);
    const [last, setLast] = useState<string | null>(null);
    useEffect(() => {
      if (open) return;
      const t = setTimeout(() => setOpen(true), 1500);
      return () => clearTimeout(t);
    }, [open]);
    return (
      <PageShell>
        <div className="flex flex-col items-start gap-2">
          <AnimatePresence>
            {open ? (
              <FeatureBanner
                key="banner"
                {...args}
                onDismiss={() => {
                  setLast("dismissed");
                  setOpen(false);
                }}
                onFollow={() => {
                  setLast("followed");
                  setOpen(false);
                }}
              />
            ) : null}
          </AnimatePresence>
          {last ? <Text variant="muted">Last action: {last}</Text> : null}
        </div>
      </PageShell>
    );
  },
};
