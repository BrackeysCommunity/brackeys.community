import { Chart01Icon, GridViewIcon, ListViewIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { SegmentedControl } from "@/components/ui/segmented-control";
import { Heading, InlineCode, Text } from "@/components/ui/typography";

const meta: Meta<typeof SegmentedControl> = {
  title: "Components/SegmentedControl",
  component: SegmentedControl,
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
type Story = StoryObj<typeof SegmentedControl>;

export const Overview: Story = {
  render: () => {
    const [basic, setBasic] = useState("two");
    const [md, setMd] = useState("one");
    const [sm, setSm] = useState("one");
    const [xs, setXs] = useState("one");
    const [pri, setPri] = useState("one");
    const [view, setView] = useState("list");
    const [range, setRange] = useState("24h");
    const [mode, setMode] = useState("auto");
    const [tip, setTip] = useState("list");
    const [disabledValue, setDisabledValue] = useState("one");

    return (
      <>
        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Imports
          </Heading>
          <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
            <code>
              <span className="text-primary">import</span>
              {" { SegmentedControl } "}
              <span className="text-primary">from</span>
              {" '@/components/ui/segmented-control';"}
            </code>
          </pre>
          <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
            <InlineCode>SegmentedControl</InlineCode> is a group of buttons that function as a
            single control for selecting one option. Use it instead of tabs or radios when you need
            a compact, button-like appearance — toolbars, filter toggles, view switchers.
          </Text>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Basic Usage
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Controlled component — manage the selected value in state and update via{" "}
            <InlineCode>onChange</InlineCode>.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex items-center gap-4">
              <Text size="xs" variant="muted">
                Selected: {basic}
              </Text>
              <SegmentedControl value={basic} onChange={setBasic}>
                <SegmentedControl.Item value="one">One</SegmentedControl.Item>
                <SegmentedControl.Item value="two">Two</SegmentedControl.Item>
                <SegmentedControl.Item value="three">Three</SegmentedControl.Item>
              </SegmentedControl>
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`const [value, setValue] = useState('two');

<SegmentedControl value={value} onChange={setValue}>
  <SegmentedControl.Item value="one">One</SegmentedControl.Item>
  <SegmentedControl.Item value="two">Two</SegmentedControl.Item>
  <SegmentedControl.Item value="three">Three</SegmentedControl.Item>
</SegmentedControl>`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Sizes
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Three sizes: <InlineCode>md</InlineCode> (default), <InlineCode>sm</InlineCode>, and{" "}
            <InlineCode>xs</InlineCode>.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex flex-col items-start gap-3">
              <SegmentedControl size="md" value={md} onChange={setMd}>
                <SegmentedControl.Item value="one">Medium</SegmentedControl.Item>
                <SegmentedControl.Item value="two">Default</SegmentedControl.Item>
                <SegmentedControl.Item value="three">Size</SegmentedControl.Item>
              </SegmentedControl>
              <SegmentedControl size="sm" value={sm} onChange={setSm}>
                <SegmentedControl.Item value="one">Small</SegmentedControl.Item>
                <SegmentedControl.Item value="two">Size</SegmentedControl.Item>
                <SegmentedControl.Item value="three">Here</SegmentedControl.Item>
              </SegmentedControl>
              <SegmentedControl size="xs" value={xs} onChange={setXs}>
                <SegmentedControl.Item value="one">Extra</SegmentedControl.Item>
                <SegmentedControl.Item value="two">Small</SegmentedControl.Item>
                <SegmentedControl.Item value="three">Size</SegmentedControl.Item>
              </SegmentedControl>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Priorities
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Use <InlineCode>priority</InlineCode> to switch between <InlineCode>default</InlineCode>{" "}
            (outlined) and <InlineCode>primary</InlineCode> (filled).
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex flex-col items-start gap-3">
              <SegmentedControl priority="default" value={pri} onChange={setPri}>
                <SegmentedControl.Item value="one">Default</SegmentedControl.Item>
                <SegmentedControl.Item value="two">Priority</SegmentedControl.Item>
                <SegmentedControl.Item value="three">Here</SegmentedControl.Item>
              </SegmentedControl>
              <SegmentedControl priority="primary" value={pri} onChange={setPri}>
                <SegmentedControl.Item value="one">Primary</SegmentedControl.Item>
                <SegmentedControl.Item value="two">Priority</SegmentedControl.Item>
                <SegmentedControl.Item value="three">Here</SegmentedControl.Item>
              </SegmentedControl>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Icons
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Items can include icons via the <InlineCode>icon</InlineCode> prop.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <SegmentedControl value={view} onChange={setView}>
              <SegmentedControl.Item value="list" icon={<HugeiconsIcon icon={ListViewIcon} />}>
                List
              </SegmentedControl.Item>
              <SegmentedControl.Item value="grid" icon={<HugeiconsIcon icon={GridViewIcon} />}>
                Grid
              </SegmentedControl.Item>
              <SegmentedControl.Item
                value="chart"
                icon={<HugeiconsIcon icon={Chart01Icon} />}
                aria-label="Chart view"
              />
            </SegmentedControl>
            <Text size="xs" variant="muted">
              Icon-only items must include <InlineCode>aria-label</InlineCode> for accessibility.
            </Text>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Disabled Items
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Disable individual items using the <InlineCode>disabled</InlineCode> prop.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <SegmentedControl value={disabledValue} onChange={setDisabledValue}>
              <SegmentedControl.Item value="one">Enabled</SegmentedControl.Item>
              <SegmentedControl.Item value="two" disabled>
                Disabled
              </SegmentedControl.Item>
              <SegmentedControl.Item value="three">Active</SegmentedControl.Item>
            </SegmentedControl>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Tooltips
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Pass a <InlineCode>tooltip</InlineCode> for additional context on hover.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <SegmentedControl value={tip} onChange={setTip}>
              <SegmentedControl.Item value="list" tooltip="Show list view">
                List
              </SegmentedControl.Item>
              <SegmentedControl.Item value="grid" tooltip="Show grid view">
                Grid
              </SegmentedControl.Item>
            </SegmentedControl>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Usage Patterns
          </Heading>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex flex-col gap-2">
              <Text size="xs" variant="muted" monospace>
                View switcher
              </Text>
              <SegmentedControl value={view} onChange={setView}>
                <SegmentedControl.Item value="list" icon={<HugeiconsIcon icon={ListViewIcon} />}>
                  List
                </SegmentedControl.Item>
                <SegmentedControl.Item value="grid" icon={<HugeiconsIcon icon={GridViewIcon} />}>
                  Grid
                </SegmentedControl.Item>
                <SegmentedControl.Item value="chart" icon={<HugeiconsIcon icon={Chart01Icon} />}>
                  Chart
                </SegmentedControl.Item>
              </SegmentedControl>
            </div>
            <div className="flex flex-col gap-2">
              <Text size="xs" variant="muted" monospace>
                Time range
              </Text>
              <SegmentedControl value={range} onChange={setRange}>
                <SegmentedControl.Item value="1h">1H</SegmentedControl.Item>
                <SegmentedControl.Item value="24h">24H</SegmentedControl.Item>
                <SegmentedControl.Item value="7d">7D</SegmentedControl.Item>
                <SegmentedControl.Item value="30d">30D</SegmentedControl.Item>
              </SegmentedControl>
            </div>
            <div className="flex flex-col gap-2">
              <Text size="xs" variant="muted" monospace>
                Display mode
              </Text>
              <SegmentedControl size="sm" value={mode} onChange={setMode}>
                <SegmentedControl.Item value="auto">Auto</SegmentedControl.Item>
                <SegmentedControl.Item value="light">Light</SegmentedControl.Item>
                <SegmentedControl.Item value="dark">Dark</SegmentedControl.Item>
              </SegmentedControl>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            SegmentedControl vs Tabs vs Radio
          </Heading>
          <div className="max-w-xl space-y-3">
            <Text as="p" size="xs" variant="muted" density="comfortable">
              <strong>Use SegmentedControl</strong> when you need a compact button-like toggle
              between 2–5 options in a toolbar or header, where all options are always visible and
              changes take effect immediately.
            </Text>
            <Text as="p" size="xs" variant="muted" density="comfortable">
              <strong>Use Tabs</strong> when organizing different content sections, each with an
              associated panel, or when you have more than 5 options.
            </Text>
            <Text as="p" size="xs" variant="muted" density="comfortable">
              <strong>Use Radio</strong> when the selection is part of a form that requires
              submission, when options need detailed labels, or when the layout should be vertical.
            </Text>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Accessibility
          </Heading>
          <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
            Built on <InlineCode>@base-ui/react/toggle-group</InlineCode>. Supports full keyboard
            navigation: <InlineCode>Tab</InlineCode> moves focus into/out of the control,{" "}
            <InlineCode>←/→</InlineCode> navigates between items, and{" "}
            <InlineCode>Space/Enter</InlineCode> selects the focused item. Icon-only items must
            include an <InlineCode>aria-label</InlineCode>.
          </Text>
        </section>
      </>
    );
  },
};
