import {
  Add01Icon,
  Download04Icon,
  Delete02Icon,
  Settings01Icon,
  Search01Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Meta, StoryObj } from "@storybook/react";

import { Button } from "@/components/ui/button";
import { Heading, Text, InlineCode } from "@/components/ui/typography";

const meta: Meta<typeof Button> = {
  title: "Components/Button",
  component: Button,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="flex min-w-[600px] flex-col items-start gap-10 bg-background p-12">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Button>;

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
            {" { Button } "}
            <span className="text-primary">from</span>
            {" '@/components/ui/button';"}
          </code>
        </pre>
        <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
          The Button component is the primary interactive element. It supports multiple visual
          variants, sizes, icon placement, and an optional magnetic hover effect. All buttons use
          sharp 0-radius corners consistent with the Brackeys design system.
        </Text>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Variants
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Buttons come in several visual styles: <InlineCode>default</InlineCode>,{" "}
          <InlineCode>outline</InlineCode>, <InlineCode>secondary</InlineCode>,{" "}
          <InlineCode>ghost</InlineCode>, <InlineCode>destructive</InlineCode>, and{" "}
          <InlineCode>link</InlineCode>.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button variant="default">Default</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Button variant="default">Default</Button>
<Button variant="outline">Outline</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="destructive">Destructive</Button>
<Button variant="link">Link</Button>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Sizes
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Available sizes: <InlineCode>xs</InlineCode>, <InlineCode>sm</InlineCode>,{" "}
          <InlineCode>default</InlineCode>, and <InlineCode>lg</InlineCode>.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex items-end justify-center gap-3">
            <Button size="xs">Extra Small</Button>
            <Button size="sm">Small</Button>
            <Button size="default">Default</Button>
            <Button size="lg">Large</Button>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Button size="xs">Extra Small</Button>
<Button size="sm">Small</Button>
<Button size="default">Default</Button>
<Button size="lg">Large</Button>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Icons
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Buttons support leading and trailing icons via <InlineCode>data-icon</InlineCode>{" "}
          attributes. Icon size adjusts automatically based on button size.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button>
              <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
              Add Item
            </Button>
            <Button variant="outline">
              Download
              <HugeiconsIcon icon={Download04Icon} data-icon="inline-end" />
            </Button>
            <Button variant="destructive">
              <HugeiconsIcon icon={Delete02Icon} data-icon="inline-start" />
              Delete
            </Button>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Button>
  <HugeiconsIcon icon={Add01Icon} data-icon="inline-start" />
  Add Item
</Button>
<Button variant="outline">
  Download
  <HugeiconsIcon icon={Download04Icon} data-icon="inline-end" />
</Button>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Disabled Buttons
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Disabled buttons indicate that an action is not available.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex items-center justify-center gap-3">
            <Button disabled variant="outline">
              Cancel
            </Button>
            <Button disabled>Submit</Button>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Button disabled variant="outline">Cancel</Button>
<Button disabled>Submit</Button>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Icon-only Buttons
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Use icon sizes (<InlineCode>icon</InlineCode>, <InlineCode>icon-xs</InlineCode>,{" "}
          <InlineCode>icon-sm</InlineCode>, <InlineCode>icon-lg</InlineCode>) for square icon
          buttons.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex items-end justify-center gap-3">
            <Button size="icon-xs" variant="outline">
              <HugeiconsIcon icon={Search01Icon} />
            </Button>
            <Button size="icon-sm" variant="outline">
              <HugeiconsIcon icon={Settings01Icon} />
            </Button>
            <Button size="icon" variant="outline">
              <HugeiconsIcon icon={Add01Icon} />
            </Button>
            <Button size="icon-lg" variant="outline">
              <HugeiconsIcon icon={ArrowRight01Icon} />
            </Button>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Button size="icon-xs" variant="outline">
  <HugeiconsIcon icon={Search01Icon} />
</Button>
<Button size="icon-sm" variant="outline">
  <HugeiconsIcon icon={Settings01Icon} />
</Button>
<Button size="icon" variant="outline">
  <HugeiconsIcon icon={Add01Icon} />
</Button>
<Button size="icon-lg" variant="outline">
  <HugeiconsIcon icon={ArrowRight01Icon} />
</Button>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          All Variants x Sizes
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Complete matrix of every variant at every size for visual QA.
        </Text>
        <div className="overflow-x-auto border border-border bg-card p-8">
          <table className="w-full">
            <thead>
              <tr>
                <th className="pr-6 pb-4 text-left">
                  <Text size="xs" variant="muted" monospace>
                    Variant
                  </Text>
                </th>
                <th className="pr-4 pb-4 text-left">
                  <Text size="xs" variant="muted" monospace>
                    xs
                  </Text>
                </th>
                <th className="pr-4 pb-4 text-left">
                  <Text size="xs" variant="muted" monospace>
                    sm
                  </Text>
                </th>
                <th className="pr-4 pb-4 text-left">
                  <Text size="xs" variant="muted" monospace>
                    default
                  </Text>
                </th>
                <th className="pr-4 pb-4 text-left">
                  <Text size="xs" variant="muted" monospace>
                    lg
                  </Text>
                </th>
              </tr>
            </thead>
            <tbody>
              {(["default", "outline", "secondary", "ghost", "destructive", "link"] as const).map(
                (variant) => (
                  <tr key={variant} className="align-middle">
                    <td className="py-2 pr-6">
                      <Text size="xs" variant="muted" monospace>
                        {variant}
                      </Text>
                    </td>
                    {(["xs", "sm", "default", "lg"] as const).map((size) => (
                      <td key={size} className="py-2 pr-4">
                        <Button variant={variant} size={size}>
                          Label
                        </Button>
                      </td>
                    ))}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Notched Variant
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Pass <InlineCode>notchOpts</InlineCode> to clip corners with a chamfer. Defaults to
          top-right and bottom-left.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Button notchOpts>Default</Button>
            <Button variant="outline" notchOpts>
              Outline
            </Button>
            <Button variant="secondary" notchOpts>
              Secondary
            </Button>
            <Button variant="destructive" notchOpts>
              Destructive
            </Button>
          </div>
          <div className="flex flex-wrap items-end justify-center gap-4">
            <Button size="xs" notchOpts>
              XS
            </Button>
            <Button size="sm" notchOpts>
              SM
            </Button>
            <Button notchOpts>Default</Button>
            <Button size="lg" notchOpts>
              LG
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Button notchOpts={{ corners: ["tr"] }}>Top Right</Button>
            <Button notchOpts={{ corners: ["bl"] }}>Bottom Left</Button>
            <Button notchOpts={{ corners: ["tl", "br"] }}>TL + BR</Button>
            <Button notchOpts={{ corners: ["tl", "tr", "bl", "br"], size: 10 }}>All Corners</Button>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Button notchOpts>Default</Button>
<Button variant="outline" notchOpts>Outline</Button>
<Button notchOpts={{ corners: ["tl", "br"] }}>Custom</Button>
<Button notchOpts={{ corners: ["tl", "tr", "bl", "br"], size: 10 }}>All</Button>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Accessibility
        </Heading>
        <div className="max-w-xl space-y-2">
          <Text as="p" size="xs" variant="muted" density="comfortable">
            Buttons are built on <InlineCode>@base-ui/react/button</InlineCode> which provides
            proper <InlineCode>role="button"</InlineCode> semantics, keyboard support (Enter/Space),
            and focus management.
          </Text>
          <Text as="p" size="xs" variant="muted" density="comfortable">
            Icon-only buttons should include an <InlineCode>aria-label</InlineCode> for screen
            readers since they have no visible text content.
          </Text>
        </div>
      </section>
    </>
  ),
};
