import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";

import { Slider } from "@/components/ui/slider";
import { Heading, Text, InlineCode } from "@/components/ui/typography";

const meta: Meta<typeof Slider> = {
  title: "Components/Slider",
  component: Slider,
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
type Story = StoryObj<typeof Slider>;

export const Overview: Story = {
  render: () => {
    const [val, setVal] = useState(50);
    const [stepVal, setStepVal] = useState(50);
    return (
      <>
        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Imports
          </Heading>
          <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
            <code>
              <span className="text-primary">import</span>
              {" { Slider } "}
              <span className="text-primary">from</span>
              {" '@/components/ui/slider';"}
            </code>
          </pre>
          <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
            A range slider for selecting numeric values by dragging a handle along a track. Supports
            ticks, labels, number formatting, and both horizontal and vertical orientations.
          </Text>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Basic Usage
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Value: {val}
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="mx-auto w-full max-w-sm">
              <Slider value={[val]} onValueChange={(v) => setVal(Array.isArray(v) ? v[0] : v)} />
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<Slider value={[value]} onValueChange={([v]) => setValue(v)} />`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Min and Max Values
          </Heading>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="mx-auto w-full max-w-sm">
              <Slider defaultValue={[150]} min={100} max={200} />
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<Slider defaultValue={[150]} min={100} max={200} />`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Step Control
          </Heading>
          <Text as="p" size="xs" variant="muted">
            The <InlineCode>step</InlineCode> prop restricts which values can be selected. Value:{" "}
            {stepVal}
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="mx-auto w-full max-w-sm">
              <Slider
                value={[stepVal]}
                onValueChange={(v) => setStepVal(Array.isArray(v) ? v[0] : v)}
                step={10}
              />
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<Slider step={10} />`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Tick Marks
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Ticks are purely visual indicators. Use <InlineCode>count</InlineCode>,{" "}
            <InlineCode>interval</InlineCode>, or <InlineCode>values</InlineCode>.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="mx-auto flex w-full max-w-sm flex-col gap-8">
              <div>
                <Text as="p" size="xs" variant="muted" bold>
                  11 tick marks (count)
                </Text>
                <Slider defaultValue={[50]} ticks={{ count: 11 }} />
              </div>
              <div>
                <Text as="p" size="xs" variant="muted" bold>
                  Ticks every 25 (interval)
                </Text>
                <Slider defaultValue={[50]} ticks={{ interval: 25 }} />
              </div>
              <div>
                <Text as="p" size="xs" variant="muted" bold>
                  Ticks at specific values
                </Text>
                <Slider defaultValue={[50]} ticks={{ values: [0, 10, 25, 50, 75, 100] }} />
              </div>
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<Slider ticks={{ count: 11 }} />
<Slider ticks={{ interval: 25 }} />
<Slider ticks={{ values: [0, 10, 25, 50, 75, 100] }} />`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Tick Labels
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Set <InlineCode>labels: true</InlineCode> to display value labels below each tick.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="mx-auto w-full max-w-sm">
              <Slider defaultValue={[50]} ticks={{ count: 5, labels: true }} />
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<Slider ticks={{ count: 5, labels: true }} />`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Label Formatting
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Use <InlineCode>formatOptions</InlineCode> (Intl.NumberFormatOptions) to customize tick
            labels.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="mx-auto flex w-full max-w-sm flex-col gap-8">
              <div>
                <Text as="p" size="xs" variant="muted" bold>
                  Percentage
                </Text>
                <Slider
                  defaultValue={[50]}
                  ticks={{ count: 5, labels: true }}
                  formatOptions={{ style: "unit", unit: "percent" }}
                />
              </div>
              <div>
                <Text as="p" size="xs" variant="muted" bold>
                  Currency
                </Text>
                <Slider
                  defaultValue={[500]}
                  min={0}
                  max={1000}
                  ticks={{ count: 5, labels: true }}
                  formatOptions={{
                    style: "currency",
                    currency: "USD",
                    maximumFractionDigits: 0,
                  }}
                />
              </div>
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<Slider
  ticks={{ count: 5, labels: true }}
  formatOptions={{ style: 'unit', unit: 'percent' }}
/>
<Slider
  ticks={{ count: 5, labels: true }}
  formatOptions={{ style: 'currency', currency: 'USD' }}
/>`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Disabled State
          </Heading>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="mx-auto w-full max-w-sm">
              <Slider disabled defaultValue={[50]} />
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Range Slider
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Pass an array with two values for a range selection.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="mx-auto w-full max-w-sm">
              <Slider defaultValue={[25, 75]} />
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<Slider defaultValue={[25, 75]} />`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Accessibility
          </Heading>
          <div className="max-w-xl space-y-2">
            <Text as="p" size="xs" variant="muted" density="comfortable">
              Built on <InlineCode>@base-ui/react/slider</InlineCode> which provides{" "}
              <InlineCode>role="slider"</InlineCode>, <InlineCode>aria-valuemin</InlineCode>,{" "}
              <InlineCode>aria-valuemax</InlineCode>, and{" "}
              <InlineCode>aria-valuenow</InlineCode> attributes.
            </Text>
            <Text as="p" size="xs" variant="muted" density="comfortable">
              Keyboard: Arrow Left/Down decrease, Arrow Right/Up increase. Home/End jump to
              min/max. Page Up/Down for larger increments.
            </Text>
          </div>
        </section>
      </>
    );
  },
};
