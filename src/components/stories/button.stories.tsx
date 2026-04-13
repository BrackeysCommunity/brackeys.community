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
        <h2 className="font-mono text-sm font-bold text-foreground">Imports</h2>
        <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
          <code>
            <span className="text-primary">import</span>
            {" { Button } "}
            <span className="text-primary">from</span>
            {" '@/components/ui/button';"}
          </code>
        </pre>
        <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
          The Button component is the primary interactive element. It supports multiple visual
          variants, sizes, icon placement, and an optional magnetic hover effect. All buttons use
          sharp 0-radius corners consistent with the Brackeys design system.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Variants</h2>
        <p className="text-xs text-muted-foreground">
          Buttons come in several visual styles: <code className="text-primary">default</code>,{" "}
          <code className="text-primary">outline</code>,{" "}
          <code className="text-primary">secondary</code>,{" "}
          <code className="text-primary">ghost</code>,{" "}
          <code className="text-primary">destructive</code>, and{" "}
          <code className="text-primary">link</code>.
        </p>
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
        <h2 className="font-mono text-sm font-bold text-foreground">Sizes</h2>
        <p className="text-xs text-muted-foreground">
          Available sizes: <code className="text-primary">xs</code>,{" "}
          <code className="text-primary">sm</code>, <code className="text-primary">default</code>,
          and <code className="text-primary">lg</code>.
        </p>
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
        <h2 className="font-mono text-sm font-bold text-foreground">Icons</h2>
        <p className="text-xs text-muted-foreground">
          Buttons support leading and trailing icons via{" "}
          <code className="text-primary">data-icon</code> attributes. Icon size adjusts
          automatically based on button size.
        </p>
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
        <h2 className="font-mono text-sm font-bold text-foreground">Disabled Buttons</h2>
        <p className="text-xs text-muted-foreground">
          Disabled buttons indicate that an action is not available.
        </p>
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
        <h2 className="font-mono text-sm font-bold text-foreground">Icon-only Buttons</h2>
        <p className="text-xs text-muted-foreground">
          Use icon sizes (<code className="text-primary">icon</code>,{" "}
          <code className="text-primary">icon-xs</code>,{" "}
          <code className="text-primary">icon-sm</code>,{" "}
          <code className="text-primary">icon-lg</code>) for square icon buttons.
        </p>
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
        <h2 className="font-mono text-sm font-bold text-foreground">All Variants x Sizes</h2>
        <p className="text-xs text-muted-foreground">
          Complete matrix of every variant at every size for visual QA.
        </p>
        <div className="overflow-x-auto border border-border bg-card p-8">
          <table className="w-full">
            <thead>
              <tr className="text-left font-mono text-xs text-muted-foreground">
                <th className="pr-6 pb-4">Variant</th>
                <th className="pr-4 pb-4">xs</th>
                <th className="pr-4 pb-4">sm</th>
                <th className="pr-4 pb-4">default</th>
                <th className="pr-4 pb-4">lg</th>
              </tr>
            </thead>
            <tbody>
              {(["default", "outline", "secondary", "ghost", "destructive", "link"] as const).map(
                (variant) => (
                  <tr key={variant} className="align-middle">
                    <td className="py-2 pr-6 font-mono text-xs text-muted-foreground">{variant}</td>
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
        <h2 className="font-mono text-sm font-bold text-foreground">Notched Variant</h2>
        <p className="text-xs text-muted-foreground">
          Pass <code className="text-primary">notchOpts</code> to clip corners with a chamfer.
          Defaults to top-right and bottom-left.
        </p>
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
        <h2 className="font-mono text-sm font-bold text-foreground">Accessibility</h2>
        <div className="max-w-xl space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            Buttons are built on <code className="text-primary">@base-ui/react/button</code> which
            provides proper <code className="text-primary">role="button"</code> semantics, keyboard
            support (Enter/Space), and focus management.
          </p>
          <p>
            Icon-only buttons should include an <code className="text-primary">aria-label</code> for
            screen readers since they have no visible text content.
          </p>
        </div>
      </section>
    </>
  ),
};
