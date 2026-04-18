import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { Heading, Text, InlineCode } from "@/components/ui/typography";

const meta: Meta<typeof NumberInput> = {
  title: "Components/NumberInput",
  component: NumberInput,
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
type Story = StoryObj<typeof NumberInput>;

export const Overview: Story = {
  render: () => {
    const [val, setVal] = useState<number | null>(5);
    const [stepVal, setStepVal] = useState<number | null>(0);
    return (
      <>
        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Imports
          </Heading>
          <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
            <code>
              <span className="text-primary">import</span>
              {" { NumberInput } "}
              <span className="text-primary">from</span>
              {" '@/components/ui/number-input';"}
            </code>
          </pre>
          <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
            A numeric input field with increment and decrement buttons for precise value control.
            Built on Base UI's NumberField with full keyboard support (Arrow Up/Down, Page Up/Down,
            Home/End).
          </Text>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Basic Usage
          </Heading>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="mx-auto w-full max-w-xs">
              <NumberInput defaultValue={5} min={0} max={10} />
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<NumberInput defaultValue={5} min={0} max={10} />`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Sizes
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Supports <InlineCode>default</InlineCode> (h-8) and <InlineCode>xs</InlineCode> (h-6)
            sizes.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="mx-auto flex w-full max-w-xs flex-col gap-3">
              <div>
                <Text as="p" size="xs" variant="muted" bold>
                  default
                </Text>
                <NumberInput defaultValue={42} />
              </div>
              <div>
                <Text as="p" size="xs" variant="muted" bold>
                  xs
                </Text>
                <NumberInput size="xs" defaultValue={42} />
              </div>
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<NumberInput defaultValue={42} />
<NumberInput size="xs" defaultValue={42} />`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Min and Max Values
          </Heading>
          <Text as="p" size="xs" variant="muted">
            The step buttons disable when bounds are reached. Value: {val}
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="mx-auto w-full max-w-xs">
              <NumberInput value={val} onValueChange={setVal} min={0} max={10} />
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<NumberInput value={value} onValueChange={setValue} min={0} max={10} />`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Step Control
          </Heading>
          <Text as="p" size="xs" variant="muted">
            The <InlineCode>step</InlineCode> prop controls increment/decrement amount. Value:{" "}
            {stepVal}
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="mx-auto w-full max-w-xs">
              <NumberInput value={stepVal} onValueChange={setStepVal} step={5} min={0} max={100} />
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<NumberInput step={5} min={0} max={100} />`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            States
          </Heading>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="mx-auto flex w-full max-w-xs flex-col gap-3">
              <div>
                <Text as="p" size="xs" variant="muted" bold>
                  Disabled
                </Text>
                <NumberInput defaultValue={42} disabled />
              </div>
              <div>
                <Text as="p" size="xs" variant="muted" bold>
                  Read-only
                </Text>
                <NumberInput defaultValue={42} readOnly />
              </div>
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<NumberInput defaultValue={42} disabled />
<NumberInput defaultValue={42} readOnly />`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Placeholder and Monospace
          </Heading>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="mx-auto flex w-full max-w-xs flex-col gap-3">
              <NumberInput placeholder="Enter a number" />
              <NumberInput defaultValue={12345} monospace />
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<NumberInput placeholder="Enter a number" />
<NumberInput defaultValue={12345} monospace />`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Notched Variant
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Pass <InlineCode>notchOpts</InlineCode> to clip corners with a chamfer.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="mx-auto flex w-full max-w-xs flex-col gap-3">
              <NumberInput notchOpts defaultValue={42} />
              <NumberInput notchOpts={{ corners: ["tl", "br"] }} defaultValue={42} />
              <NumberInput size="xs" notchOpts defaultValue={42} />
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<NumberInput notchOpts defaultValue={42} />
<NumberInput notchOpts={{ corners: ["tl", "br"] }} defaultValue={42} />
<NumberInput size="xs" notchOpts defaultValue={42} />`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            With Field Labels
          </Heading>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="mx-auto flex w-full max-w-xs flex-col gap-5">
              <Field>
                <FieldLabel>Quantity</FieldLabel>
                <NumberInput defaultValue={1} min={1} max={99} />
                <FieldDescription>How many items?</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Timeout (seconds)</FieldLabel>
                <NumberInput defaultValue={30} min={0} max={300} step={5} />
              </Field>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Accessibility
          </Heading>
          <div className="max-w-xl space-y-2">
            <Text as="p" size="xs" variant="muted" density="comfortable">
              Built on Base UI's NumberField which provides full ARIA spin button semantics
              including <InlineCode>role="spinbutton"</InlineCode>,{" "}
              <InlineCode>aria-valuemin</InlineCode>, <InlineCode>aria-valuemax</InlineCode>, and{" "}
              <InlineCode>aria-valuenow</InlineCode> attributes.
            </Text>
            <Text as="p" size="xs" variant="muted" density="comfortable">
              Keyboard: Arrow Up/Down increment/decrement by step. Page Up/Down use large step.
              Home/End jump to min/max.
            </Text>
          </div>
        </section>
      </>
    );
  },
};
