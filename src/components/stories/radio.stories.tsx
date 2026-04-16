import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Heading, Text, InlineCode } from "@/components/ui/typography";

const meta: Meta<typeof RadioGroup> = {
  title: "Components/Radio",
  component: RadioGroup,
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
type Story = StoryObj<typeof RadioGroup>;

export const Overview: Story = {
  render: () => {
    const [selected, setSelected] = useState("option2");
    return (
      <>
        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Imports
          </Heading>
          <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
            <code>
              <span className="text-primary">import</span>
              {" { RadioGroup, RadioGroupItem } "}
              <span className="text-primary">from</span>
              {" '@/components/ui/radio-group';"}
            </code>
          </pre>
          <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
            Radio buttons for selecting a single option from a set of mutually exclusive choices.
            Always use in groups where only one option can be selected at a time.
          </Text>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Sizes
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Available in <InlineCode>md</InlineCode> and <InlineCode>sm</InlineCode> (default).
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex items-center gap-8">
              <div className="flex flex-col gap-2">
                <Text size="xs" variant="muted" bold>
                  md
                </Text>
                <RadioGroup defaultValue="a" className="flex-row gap-3">
                  <RadioGroupItem size="md" value="a" />
                  <RadioGroupItem size="md" value="b" />
                </RadioGroup>
              </div>
              <div className="flex flex-col gap-2">
                <Text size="xs" variant="muted" bold>
                  sm (default)
                </Text>
                <RadioGroup defaultValue="a" className="flex-row gap-3">
                  <RadioGroupItem size="sm" value="a" />
                  <RadioGroupItem size="sm" value="b" />
                </RadioGroup>
              </div>
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<RadioGroupItem size="md" checked />
<RadioGroupItem size="sm" checked />`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            States
          </Heading>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex flex-wrap items-center gap-6">
              <RadioGroup defaultValue="checked" className="flex-row gap-6">
                <span className="flex items-center gap-2 text-xs text-foreground">
                  <RadioGroupItem value="checked" aria-label="Checked" />
                  Checked
                </span>
                <span className="flex items-center gap-2 text-xs text-foreground">
                  <RadioGroupItem value="unchecked" aria-label="Unchecked" />
                  Unchecked
                </span>
              </RadioGroup>
              <RadioGroup defaultValue="checked-disabled" className="flex-row gap-6">
                <span className="flex items-center gap-2 text-xs text-foreground">
                  <RadioGroupItem value="disabled" disabled aria-label="Disabled" />
                  Disabled
                </span>
                <span className="flex items-center gap-2 text-xs text-foreground">
                  <RadioGroupItem value="checked-disabled" disabled aria-label="Disabled Checked" />
                  Disabled Checked
                </span>
              </RadioGroup>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Radio Groups
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Radio buttons should always be used in groups. Selected: {selected}
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <RadioGroup value={selected} onValueChange={setSelected} aria-label="Choose an option">
              {["option1", "option2", "option3"].map((opt) => (
                <label key={opt} className="flex items-center gap-2 text-xs text-foreground">
                  <RadioGroupItem value={opt} />
                  {opt.replace("option", "Option ")}
                </label>
              ))}
            </RadioGroup>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<RadioGroup value={selected} onValueChange={setSelected}>
  <label>
    <RadioGroupItem value="option1" />
    Option 1
  </label>
  <label>
    <RadioGroupItem value="option2" />
    Option 2
  </label>
</RadioGroup>`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Accessibility
          </Heading>
          <div className="max-w-xl space-y-2">
            <Text as="p" size="xs" variant="muted" density="comfortable">
              Built on <InlineCode>@base-ui/react/radio</InlineCode> and{" "}
              <InlineCode>@base-ui/react/radio-group</InlineCode>. Use{" "}
              <InlineCode>&lt;label&gt;</InlineCode> wrapping both the radio and text. Group related
              radios with <InlineCode>RadioGroup</InlineCode> which provides{" "}
              <InlineCode>role="radiogroup"</InlineCode>.
            </Text>
            <Text as="p" size="xs" variant="muted" density="comfortable">
              Keyboard: Tab moves to/from the group. Arrow keys navigate between options. Space
              selects the focused radio.
            </Text>
          </div>
        </section>
      </>
    );
  },
};
