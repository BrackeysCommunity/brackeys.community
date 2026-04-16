import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectMultiTrigger,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
} from "@/components/ui/select";
import { Heading, Text, InlineCode } from "@/components/ui/typography";

const meta: Meta<typeof Select> = {
  title: "Components/Select",
  component: Select,
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
type Story = StoryObj<typeof Select>;

const allOptions = [
  { value: "item1", label: "Item 1" },
  { value: "item2", label: "Item 2" },
  { value: "item3", label: "Item 3" },
  { value: "item4", label: "Item 4" },
  { value: "item5", label: "Item 5" },
];

export const Overview: Story = {
  render: () => {
    const [multiValue, setMultiValue] = useState<string[]>(["item1", "item3"]);
    const [multiClearable, setMultiClearable] = useState<string[]>(["item1", "item3"]);

    const multiLabels = multiValue
      .map((v) => allOptions.find((o) => o.value === v))
      .filter(Boolean) as { value: string; label: string }[];

    const multiClearableLabels = multiClearable
      .map((v) => allOptions.find((o) => o.value === v))
      .filter(Boolean) as { value: string; label: string }[];

    return (
      <>
        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Imports
          </Heading>
          <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
            <code>
              <span className="text-primary">import</span>
              {" { Select, SelectTrigger, SelectValue, SelectContent, SelectItem,"}
              <br />
              {"  SelectMultiTrigger } "}
              <span className="text-primary">from</span>
              {" '@/components/ui/select';"}
            </code>
          </pre>
          <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
            A dropdown select component built on Base UI. Supports single and multi-select modes,
            groups, labels, separators, clearable triggers with badges, notch variants, and three
            sizes.
          </Text>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Basic Usage
          </Heading>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex justify-center">
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="Choose an option" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="option1">Option 1</SelectItem>
                  <SelectItem value="option2">Option 2</SelectItem>
                  <SelectItem value="option3">Option 3</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<Select>
  <SelectTrigger>
    <SelectValue placeholder="Choose an option" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="option1">Option 1</SelectItem>
  </SelectContent>
</Select>`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Sizes
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Trigger sizes: <InlineCode>default</InlineCode> (h-8),{" "}
            <InlineCode>sm</InlineCode> (h-7), <InlineCode>xs</InlineCode> (h-6).
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex flex-wrap items-end justify-center gap-3">
              {(["default", "sm", "xs"] as const).map((size) => (
                <Select key={size} defaultValue="item1">
                  <SelectTrigger size={size}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="item1">{size}</SelectItem>
                    <SelectItem value="item2">Item 2</SelectItem>
                  </SelectContent>
                </Select>
              ))}
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<SelectTrigger size="default">...</SelectTrigger>
<SelectTrigger size="sm">...</SelectTrigger>
<SelectTrigger size="xs">...</SelectTrigger>`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Multiple Selection
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Use <InlineCode>multiple</InlineCode> on the Select root and{" "}
            <InlineCode>SelectMultiTrigger</InlineCode> to display selected items as badges. Each
            badge has an × button to remove individual selections.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="mx-auto flex w-full max-w-sm flex-col gap-3">
              {(["default", "sm", "xs"] as const).map((size) => (
                <Select
                  key={size}
                  multiple
                  value={multiValue}
                  onValueChange={setMultiValue}
                >
                  <SelectMultiTrigger
                    size={size}
                    selectedLabels={multiLabels}
                    onRemove={(val) => setMultiValue((prev) => prev.filter((v) => v !== val))}
                    placeholder="Select items..."
                  />
                  <SelectContent>
                    {allOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ))}
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<Select multiple value={selected} onValueChange={setSelected}>
  <SelectMultiTrigger
    selectedLabels={labels}
    onRemove={(val) => setSelected(prev => prev.filter(v => v !== val))}
    placeholder="Select items..."
  />
  <SelectContent>
    <SelectItem value="item1">Item 1</SelectItem>
    <SelectItem value="item2">Item 2</SelectItem>
  </SelectContent>
</Select>`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Multiple Selection with Clear
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Add <InlineCode>onClear</InlineCode> to show a clear-all × button when items are
            selected.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="mx-auto flex w-full max-w-sm flex-col gap-3">
              {(["default", "sm", "xs"] as const).map((size) => (
                <Select
                  key={size}
                  multiple
                  value={multiClearable}
                  onValueChange={setMultiClearable}
                >
                  <SelectMultiTrigger
                    size={size}
                    selectedLabels={multiClearableLabels}
                    onRemove={(val) =>
                      setMultiClearable((prev) => prev.filter((v) => v !== val))
                    }
                    onClear={() => setMultiClearable([])}
                    placeholder="Select items..."
                  />
                  <SelectContent>
                    {allOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ))}
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<SelectMultiTrigger
  selectedLabels={labels}
  onRemove={(val) => ...}
  onClear={() => setSelected([])}
/>`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Notched Multi-Select
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Combine <InlineCode>notchOpts</InlineCode> on the trigger with{" "}
            <InlineCode>badgeNotchOpts</InlineCode> for notched badges inside. Use{" "}
            <InlineCode>badgeVariant</InlineCode> to control badge appearance.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="mx-auto flex w-full max-w-sm flex-col gap-3">
              <Text as="p" size="xs" variant="muted" bold>
                Notched trigger, regular badges
              </Text>
              <Select multiple value={multiValue} onValueChange={setMultiValue}>
                <SelectMultiTrigger
                  notchOpts
                  selectedLabels={multiLabels}
                  onRemove={(val) => setMultiValue((prev) => prev.filter((v) => v !== val))}
                  onClear={() => setMultiValue([])}
                  placeholder="Select items..."
                />
                <SelectContent>
                  {allOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Text as="p" size="xs" variant="muted" bold>
                Notched trigger + notched badges
              </Text>
              <Select multiple value={multiClearable} onValueChange={setMultiClearable}>
                <SelectMultiTrigger
                  notchOpts
                  badgeNotchOpts
                  selectedLabels={multiClearableLabels}
                  onRemove={(val) =>
                    setMultiClearable((prev) => prev.filter((v) => v !== val))
                  }
                  onClear={() => setMultiClearable([])}
                  placeholder="Select items..."
                />
                <SelectContent>
                  {allOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Text as="p" size="xs" variant="muted" bold>
                Notched trigger + default variant badges
              </Text>
              <Select multiple value={multiValue} onValueChange={setMultiValue}>
                <SelectMultiTrigger
                  notchOpts
                  badgeVariant="default"
                  badgeNotchOpts
                  selectedLabels={multiLabels}
                  onRemove={(val) => setMultiValue((prev) => prev.filter((v) => v !== val))}
                  onClear={() => setMultiValue([])}
                  placeholder="Select items..."
                />
                <SelectContent>
                  {allOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<SelectMultiTrigger
  notchOpts
  badgeNotchOpts
  badgeVariant="default"
  selectedLabels={labels}
  onRemove={...}
  onClear={...}
/>`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Notched Trigger
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Pass <InlineCode>notchOpts</InlineCode> on triggers for chamfered corners.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex flex-wrap items-end justify-center gap-3">
              <Select defaultValue="item1">
                <SelectTrigger notchOpts>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="item1">Notched Default</SelectItem>
                  <SelectItem value="item2">Option 2</SelectItem>
                </SelectContent>
              </Select>
              <Select defaultValue="item1">
                <SelectTrigger size="xs" notchOpts>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="item1">Notched XS</SelectItem>
                  <SelectItem value="item2">Option 2</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Groups and Labels
          </Heading>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex justify-center">
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a fruit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Citrus</SelectLabel>
                    <SelectItem value="orange">Orange</SelectItem>
                    <SelectItem value="lemon">Lemon</SelectItem>
                    <SelectItem value="grapefruit">Grapefruit</SelectItem>
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Berries</SelectLabel>
                    <SelectItem value="strawberry">Strawberry</SelectItem>
                    <SelectItem value="blueberry">Blueberry</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Disabled
          </Heading>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex items-center gap-3">
              <Select disabled>
                <SelectTrigger>
                  <SelectValue placeholder="Disabled select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="a">A</SelectItem>
                </SelectContent>
              </Select>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="With disabled item" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="a">Available</SelectItem>
                  <SelectItem value="b" disabled>
                    Unavailable
                  </SelectItem>
                  <SelectItem value="c">Also available</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Accessibility
          </Heading>
          <div className="max-w-xl space-y-2">
            <Text as="p" size="xs" variant="muted" density="comfortable">
              Built on <InlineCode>@base-ui/react/select</InlineCode> with proper listbox
              semantics. Keyboard: Arrow Up/Down navigate, Enter selects, Escape closes.
            </Text>
            <Text as="p" size="xs" variant="muted" density="comfortable">
              Multi-select uses checkmarks on items. Individual badge × buttons and the clear-all
              button are keyboard accessible. Always pair with a visible label or{" "}
              <InlineCode>aria-label</InlineCode>.
            </Text>
          </div>
        </section>
      </>
    );
  },
};
