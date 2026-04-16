import type { Meta, StoryObj } from "@storybook/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SimpleTooltip, Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Heading, InlineCode, Text } from "@/components/ui/typography";

const meta: Meta<typeof SimpleTooltip> = {
  title: "Components/Tooltip",
  component: SimpleTooltip,
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
type Story = StoryObj<typeof SimpleTooltip>;

export const Overview: Story = {
  render: () => (
    <>
      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Imports
        </Heading>
        <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
          <code>
            <span className="text-primary">import</span>
            {" { SimpleTooltip } "}
            <span className="text-primary">from</span>
            {" '@/components/ui/tooltip';\n"}
            <span className="text-muted-foreground">// Or compound API:</span>
            {"\n"}
            <span className="text-primary">import</span>
            {" { Tooltip, TooltipTrigger, TooltipContent } "}
            <span className="text-primary">from</span>
            {" '@/components/ui/tooltip';"}
          </code>
        </pre>
        <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
          Tooltips provide contextual information on hover. Use{" "}
          <InlineCode>SimpleTooltip</InlineCode> for the wrapping API, or the compound{" "}
          <InlineCode>Tooltip</InlineCode>/<InlineCode>TooltipTrigger</InlineCode>/
          <InlineCode>TooltipContent</InlineCode> for advanced control.
        </Text>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Basic Usage
        </Heading>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex justify-center">
            <SimpleTooltip content="This is a helpful tooltip">
              <Button variant="outline">Hover me</Button>
            </SimpleTooltip>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<SimpleTooltip content="This is a helpful tooltip">
  <Button>Hover me</Button>
</SimpleTooltip>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Position
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Use the <InlineCode>side</InlineCode> prop to control placement.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-wrap justify-center gap-3">
            {(["top", "bottom", "left", "right"] as const).map((side) => (
              <SimpleTooltip key={side} content={`${side} tooltip`} side={side}>
                <Button variant="outline">{side.charAt(0).toUpperCase() + side.slice(1)}</Button>
              </SimpleTooltip>
            ))}
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<SimpleTooltip content="Top" side="top">...</SimpleTooltip>
<SimpleTooltip content="Bottom" side="bottom">...</SimpleTooltip>
<SimpleTooltip content="Left" side="left">...</SimpleTooltip>
<SimpleTooltip content="Right" side="right">...</SimpleTooltip>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Error Variant
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Use <InlineCode>variant="error"</InlineCode> for validation error tooltips. The background
          turns destructive red.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-wrap justify-center gap-3">
            <SimpleTooltip content="Default tooltip">
              <Button variant="outline">Default</Button>
            </SimpleTooltip>
            <SimpleTooltip content="This field is required" variant="error">
              <Button variant="outline">Error</Button>
            </SimpleTooltip>
            <SimpleTooltip content="Email is required" variant="error" side="bottom">
              <Input aria-invalid="true" defaultValue="invalid" className="w-48" />
            </SimpleTooltip>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<SimpleTooltip content="This field is required" variant="error">
  <Input aria-invalid="true" />
</SimpleTooltip>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Custom Width
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Control max width with the <InlineCode>maxWidth</InlineCode> prop. Default is 225px.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-wrap justify-center gap-3">
            <SimpleTooltip content="This tooltip has a long message that wraps at the default 225px width">
              <Button variant="outline">Default width</Button>
            </SimpleTooltip>
            <SimpleTooltip
              content="This tooltip has a long message that wraps at a custom 150px width"
              maxWidth={150}
            >
              <Button variant="outline">Custom width</Button>
            </SimpleTooltip>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Hoverable
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Set <InlineCode>hoverable</InlineCode> to allow users to hover over the tooltip itself
          (useful for interactive content).
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-wrap justify-center gap-3">
            <SimpleTooltip content="You can hover over this tooltip" hoverable>
              <Button variant="outline">Hoverable</Button>
            </SimpleTooltip>
            <SimpleTooltip content="This tooltip will hide quickly">
              <Button variant="outline">Non-hoverable</Button>
            </SimpleTooltip>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Rich Content
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Tooltip content can be any React node.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex justify-center">
            <SimpleTooltip
              content={
                <div className="flex flex-col gap-1">
                  <strong>Bold heading</strong>
                  <span>Paragraph text with details.</span>
                  <span className="text-muted-foreground">Additional context</span>
                </div>
              }
              maxWidth={200}
            >
              <Button variant="outline">Rich content</Button>
            </SimpleTooltip>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Disabled
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Pass <InlineCode>disabled</InlineCode> to prevent showing.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-wrap justify-center gap-3">
            <SimpleTooltip content="Visible">
              <Button variant="outline">Enabled</Button>
            </SimpleTooltip>
            <SimpleTooltip content="Hidden" disabled>
              <Button variant="outline">Disabled</Button>
            </SimpleTooltip>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Delay
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Set <InlineCode>delay</InlineCode> in ms to defer showing.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-wrap justify-center gap-3">
            <SimpleTooltip content="No delay (0ms)">
              <Button variant="outline">Instant</Button>
            </SimpleTooltip>
            <SimpleTooltip content="500ms delay" delay={500}>
              <Button variant="outline">500ms</Button>
            </SimpleTooltip>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Compound API
        </Heading>
        <Text as="p" size="xs" variant="muted">
          For advanced control, use the compound components directly.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex justify-center">
            <Tooltip>
              <TooltipTrigger render={<Button variant="outline">Compound API</Button>} />
              <TooltipContent side="bottom" variant="default">
                Using the compound API directly
              </TooltipContent>
            </Tooltip>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Tooltip>
  <TooltipTrigger render={<Button>Trigger</Button>} />
  <TooltipContent side="bottom" variant="error">
    Error message here
  </TooltipContent>
</Tooltip>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Accessibility
        </Heading>
        <div className="max-w-xl space-y-2">
          <Text as="p" size="xs" variant="muted" density="comfortable">
            Tooltips automatically include proper ARIA attributes via Base UI. The trigger receives{" "}
            <InlineCode>aria-describedby</InlineCode> pointing to the tooltip content. Tooltips are
            keyboard accessible — they show on focus and hide on Escape.
          </Text>
        </div>
      </section>
    </>
  ),
};
