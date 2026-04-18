import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AnimatePresence,
  SlideOverPanel,
  type SlideOverPanelRenderProps,
} from "@/components/ui/slide-over-panel";
import { Heading, InlineCode, Text } from "@/components/ui/typography";

const meta: Meta<typeof SlideOverPanel> = {
  title: "Components/SlideOverPanel",
  component: SlideOverPanel,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="flex min-w-[600px] flex-col items-start gap-10 bg-background p-12">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SlideOverPanel>;

function PanelContents({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <Heading as="h3" size="sm" monospace>
          Panel Contents
        </Heading>
        <Button size="sm" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
      <Text size="xs" variant="muted" density="comfortable">
        SlideOverPanel uses a spring transition so it settles into place without feeling abrupt. It
        renders on top of the app and is dismissed by user action.
      </Text>
      <div className="flex flex-col gap-2 border border-border p-3">
        <Text size="xs" variant="muted" monospace>
          Example field
        </Text>
        <div className="h-8 border border-border bg-input" />
      </div>
    </div>
  );
}

function SkeletonContents() {
  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-20 w-full" />
    </div>
  );
}

export const Overview: Story = {
  render: () => {
    const [basicOpen, setBasicOpen] = useState(false);
    const [skeletonOpen, setSkeletonOpen] = useState(false);
    const [animatedOpen, setAnimatedOpen] = useState(false);
    const [position, setPosition] = useState<"right" | "left" | "bottom">("right");

    return (
      <>
        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Imports
          </Heading>
          <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
            <code>
              <span className="text-primary">import</span>
              {" { SlideOverPanel, AnimatePresence } "}
              <span className="text-primary">from</span>
              {" '@/components/ui/slide-over-panel';"}
            </code>
          </pre>
          <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
            A multi-purpose panel for revealing supplementary UI without navigating to another page.
            Animates in with a spring transition. Useful for builders, detail views, and filter
            panels.
          </Text>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Basic Usage
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Conditionally render <InlineCode>SlideOverPanel</InlineCode> — the component handles its
            own spring-in animation on mount.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <Button onClick={() => setBasicOpen(true)}>Open Panel</Button>
            {basicOpen && (
              <SlideOverPanel position="right">
                <PanelContents onClose={() => setBasicOpen(false)} />
              </SlideOverPanel>
            )}
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<Button onClick={() => setIsOpen(true)}>Open Panel</Button>;
{isOpen && (
  <SlideOverPanel position="right">
    <PanelContents onClose={() => setIsOpen(false)} />
  </SlideOverPanel>
)}`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Position
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Panels can slide in from <InlineCode>right</InlineCode> (default),{" "}
            <InlineCode>left</InlineCode>, or <InlineCode>bottom</InlineCode>.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex flex-wrap gap-2">
              {(["right", "left", "bottom"] as const).map((p) => (
                <Button
                  key={p}
                  variant={position === p ? "default" : "outline"}
                  size="sm"
                  onClick={() => setPosition(p)}
                >
                  {p}
                </Button>
              ))}
            </div>
            <Button onClick={() => setBasicOpen(true)}>Open {position}</Button>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Skeleton UI
          </Heading>
          <Text as="p" size="xs" variant="muted" className="max-w-xl">
            <InlineCode>SlideOverPanel</InlineCode> defers rendering its contents. The panel opens
            immediately and its contents render in a subsequent pass — so the panel can respond to
            input right away even if contents are expensive to render. Pass a render prop and branch
            on <InlineCode>isOpening</InlineCode>.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <Button onClick={() => setSkeletonOpen(true)}>Open Panel</Button>
            {skeletonOpen && (
              <SlideOverPanel position="right">
                {(options: SlideOverPanelRenderProps) =>
                  options.isOpening ? (
                    <SkeletonContents />
                  ) : (
                    <PanelContents onClose={() => setSkeletonOpen(false)} />
                  )
                }
              </SlideOverPanel>
            )}
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<Button onClick={() => setIsOpen(true)}>Open Panel</Button>;
{isOpen && (
  <SlideOverPanel position="right">
    {({ isOpening }) =>
      isOpening ? <SkeletonContents /> : <PanelContents onClose={closePanel} />
    }
  </SlideOverPanel>
)}`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Animating Panel Close
          </Heading>
          <Text as="p" size="xs" variant="muted" className="max-w-xl">
            Generally, we recommend not animating on close — just remove the panel from the UI. If
            you need to animate out (e.g. coordinating with another animation), wrap in{" "}
            <InlineCode>AnimatePresence</InlineCode>.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <Button onClick={() => setAnimatedOpen(true)}>Open Panel</Button>
            <AnimatePresence>
              {animatedOpen && (
                <SlideOverPanel position="right">
                  <PanelContents onClose={() => setAnimatedOpen(false)} />
                </SlideOverPanel>
              )}
            </AnimatePresence>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<AnimatePresence>
  {isOpen && (
    <SlideOverPanel position="right">
      <PanelContents onClose={closePanel} />
    </SlideOverPanel>
  )}
</AnimatePresence>`}
            </pre>
          </div>
        </section>
      </>
    );
  },
};
