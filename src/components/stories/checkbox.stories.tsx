import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";

import { Checkbox } from "@/components/ui/checkbox";
import { Heading, Text, InlineCode } from "@/components/ui/typography";

const meta: Meta<typeof Checkbox> = {
  title: "Components/Checkbox",
  component: Checkbox,
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
type Story = StoryObj<typeof Checkbox>;

export const Overview: Story = {
  render: () => {
    const [checked, setChecked] = useState(false);
    const [items, setItems] = useState([true, false, true]);
    const allChecked = items.every(Boolean);
    const someChecked = items.some(Boolean);

    return (
      <>
        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Imports
          </Heading>
          <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
            <code>
              <span className="text-primary">import</span>
              {" { Checkbox } "}
              <span className="text-primary">from</span>
              {" '@/components/ui/checkbox';"}
            </code>
          </pre>
          <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
            Checkboxes let users select one or more items from a set. They support checked,
            unchecked, indeterminate states, three sizes, and the notched variant.
          </Text>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            States
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Checkboxes can be unchecked, checked, indeterminate, and disabled.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex flex-wrap items-center gap-6">
              {[
                { label: "Default", props: {} },
                { label: "Checked", props: { checked: true } },
                { label: "Indeterminate", props: { checked: true, indeterminate: true } },
                { label: "Disabled", props: { disabled: true } },
                { label: "Disabled Checked", props: { disabled: true, checked: true } },
                {
                  label: "Indeterminate Disabled",
                  props: { checked: true, indeterminate: true, disabled: true },
                },
              ].map(({ label, props }) => (
                <label key={label} className="flex items-center gap-2 text-xs text-foreground">
                  <Checkbox {...props} />
                  {label}
                </label>
              ))}
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<Checkbox />
<Checkbox checked />
<Checkbox checked indeterminate />
<Checkbox disabled />
<Checkbox disabled checked />`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Indeterminate State
          </Heading>
          <Text as="p" size="xs" variant="muted">
            The indeterminate state is useful for parent checkboxes in hierarchical lists.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-2 text-xs font-medium text-foreground">
                <Checkbox
                  aria-label="Select all items"
                  checked={allChecked || someChecked}
                  indeterminate={someChecked && !allChecked}
                  onCheckedChange={() => setItems(allChecked ? [false, false, false] : [true, true, true])}
                />
                Select all items
              </span>
              <div className="ml-6 flex flex-col gap-1.5">
                {["Item 1", "Item 2", "Item 3"].map((item, i) => (
                  <label key={item} className="flex items-center gap-2 text-xs text-foreground">
                    <Checkbox
                      checked={items[i]}
                      onCheckedChange={(val) => {
                        const next = [...items];
                        next[i] = !!val;
                        setItems(next);
                      }}
                    />
                    {item}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Sizes
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Available in <InlineCode>md</InlineCode>, <InlineCode>sm</InlineCode> (default), and{" "}
            <InlineCode>xs</InlineCode>.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex items-center gap-6">
              {(["md", "sm", "xs"] as const).map((size) => (
                <label key={size} className="flex items-center gap-2 text-xs text-foreground">
                  <Checkbox size={size} checked />
                  {size}
                </label>
              ))}
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<Checkbox size="md" checked />
<Checkbox size="sm" checked />  {/* default */}
<Checkbox size="xs" checked />`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Notched Variant
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Pass <InlineCode>notchOpts</InlineCode> for chamfered corners (default: 3px cut on
            tr+bl).
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex items-center gap-6">
              <span className="flex items-center gap-2 text-xs text-foreground">
                <Checkbox aria-label="Notched checked" notchOpts checked />
                Notched checked
              </span>
              <span className="flex items-center gap-2 text-xs text-foreground">
                <Checkbox aria-label="Notched unchecked" notchOpts />
                Notched unchecked
              </span>
              <span className="flex items-center gap-2 text-xs text-foreground">
                <Checkbox aria-label="Notched md" notchOpts size="md" checked />
                Notched md
              </span>
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<Checkbox notchOpts checked />
<Checkbox notchOpts size="md" checked />`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Controlled
          </Heading>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <label className="flex items-center gap-2 text-xs text-foreground">
              <Checkbox checked={checked} onCheckedChange={(val) => setChecked(!!val)} />
              I agree to the terms ({checked ? "checked" : "unchecked"})
            </label>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<Checkbox checked={checked} onCheckedChange={setChecked} />`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Accessibility
          </Heading>
          <div className="max-w-xl space-y-2">
            <Text as="p" size="xs" variant="muted" density="comfortable">
              Built on <InlineCode>@base-ui/react/checkbox</InlineCode> which provides proper ARIA
              semantics. Always wrap checkboxes in a{" "}
              <InlineCode>&lt;label&gt;</InlineCode> element for proper accessibility.
            </Text>
          </div>
        </section>
      </>
    );
  },
};
