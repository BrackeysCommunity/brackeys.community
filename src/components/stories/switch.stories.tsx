import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { Switch } from "@/components/ui/switch";
import { Heading, Text, InlineCode } from "@/components/ui/typography";

const meta: Meta<typeof Switch> = {
  title: "Components/Switch",
  component: Switch,
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
type Story = StoryObj<typeof Switch>;

export const Overview: Story = {
  render: () => {
    const [checked, setChecked] = useState(false);
    return (
      <>
        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Imports
          </Heading>
          <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
            <code>
              <span className="text-primary">import</span>
              {" { Switch } "}
              <span className="text-primary">from</span>
              {" '@/components/ui/switch';"}
            </code>
          </pre>
          <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
            Toggle controls for switching between two possible states. Uses sharp corners consistent
            with the Brackeys design system (not rounded).
          </Text>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Basic Usage
          </Heading>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex items-center gap-3">
              <Switch />
              <Switch defaultChecked />
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<Switch />
<Switch defaultChecked />`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Sizes
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Available in <InlineCode>sm</InlineCode> (default) and <InlineCode>lg</InlineCode>.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex flex-col gap-4">
              <div>
                <Text as="p" size="xs" variant="muted" bold>
                  lg
                </Text>
                <div className="flex items-center gap-3">
                  <Switch size="lg" />
                  <Switch size="lg" defaultChecked />
                  <Switch size="lg" defaultChecked disabled />
                </div>
              </div>
              <div>
                <Text as="p" size="xs" variant="muted" bold>
                  sm (default)
                </Text>
                <div className="flex items-center gap-3">
                  <Switch size="sm" />
                  <Switch size="sm" defaultChecked />
                  <Switch size="sm" defaultChecked disabled />
                </div>
              </div>
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<Switch size="lg" />
<Switch size="lg" defaultChecked />
<Switch size="sm" />
<Switch size="sm" defaultChecked />`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Notched Variant
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Pass <InlineCode>notchOpts</InlineCode> to clip the track with chamfered corners.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex items-center gap-4">
              <Switch notchOpts />
              <Switch notchOpts defaultChecked />
              <Switch size="lg" notchOpts />
              <Switch size="lg" notchOpts defaultChecked />
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<Switch notchOpts />
<Switch notchOpts defaultChecked />
<Switch size="lg" notchOpts defaultChecked />`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Controlled
          </Heading>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <label className="flex items-center gap-2 text-xs text-foreground">
              <Switch checked={checked} onCheckedChange={setChecked} />
              Notifications ({checked ? "on" : "off"})
            </label>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<Switch checked={checked} onCheckedChange={setChecked} />`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Accessibility
          </Heading>
          <div className="max-w-xl space-y-2">
            <Text as="p" size="xs" variant="muted" density="comfortable">
              Built on <InlineCode>@base-ui/react/switch</InlineCode> with proper{" "}
              <InlineCode>role="switch"</InlineCode> semantics. Always pair with a visible{" "}
              <InlineCode>&lt;label&gt;</InlineCode> or <InlineCode>aria-label</InlineCode>.
            </Text>
          </div>
        </section>
      </>
    );
  },
};
