import type { Meta, StoryObj } from "@storybook/react";

import { Badge } from "@/components/ui/badge";
import { Heading, Text, InlineCode } from "@/components/ui/typography";

const meta: Meta<typeof Badge> = {
  title: "Components/Badge",
  component: Badge,
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
type Story = StoryObj<typeof Badge>;

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
            {" { Badge } "}
            <span className="text-primary">from</span>
            {" '@/components/ui/badge';"}
          </code>
        </pre>
        <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
          Badges display status indicators, labels, or counts. The default variant has a static
          emboss shadow (like buttons, but without hover lift or active press states).
        </Text>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Variants
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Six variants: <InlineCode>default</InlineCode> (embossed),{" "}
          <InlineCode>secondary</InlineCode>, <InlineCode>destructive</InlineCode>,{" "}
          <InlineCode>outline</InlineCode>, <InlineCode>ghost</InlineCode>, and{" "}
          <InlineCode>link</InlineCode>.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Badge variant="default">Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="destructive">Destructive</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="ghost">Ghost</Badge>
            <Badge variant="link">Link</Badge>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Badge variant="default">Default</Badge>
<Badge variant="secondary">Secondary</Badge>
<Badge variant="destructive">Destructive</Badge>
<Badge variant="outline">Outline</Badge>
<Badge variant="ghost">Ghost</Badge>
<Badge variant="link">Link</Badge>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Static Emboss
        </Heading>
        <Text as="p" size="xs" variant="muted">
          The default badge has the same emboss shadow as buttons, but it's purely decorative — no
          hover lift or active press. Compare with a button:
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex items-center gap-4">
            <Badge>Static emboss</Badge>
            <Badge variant="secondary">No emboss</Badge>
            <Badge variant="outline">Outline</Badge>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Notched Variant
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Pass <InlineCode>notchOpts</InlineCode> for chamfered corners on badges.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Badge notchOpts>Default notch</Badge>
            <Badge variant="secondary" notchOpts>
              Secondary
            </Badge>
            <Badge variant="outline" notchOpts>
              Outline
            </Badge>
            <Badge variant="destructive" notchOpts>
              Destructive
            </Badge>
            <Badge notchOpts={{ corners: ["tl", "br"] }}>Custom corners</Badge>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Badge notchOpts>Default notch</Badge>
<Badge variant="secondary" notchOpts>Secondary</Badge>
<Badge notchOpts={{ corners: ["tl", "br"] }}>Custom</Badge>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Use Cases
        </Heading>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Text size="sm">Status:</Text>
              <Badge variant="default">Active</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Text size="sm">Version:</Text>
              <Badge variant="outline">v2.1.0</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Text size="sm">Environment:</Text>
              <Badge variant="secondary">Production</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Text size="sm">Priority:</Text>
              <Badge variant="destructive">Critical</Badge>
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          All Variants
        </Heading>
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
                    Normal
                  </Text>
                </th>
                <th className="pr-4 pb-4 text-left">
                  <Text size="xs" variant="muted" monospace>
                    Notched
                  </Text>
                </th>
              </tr>
            </thead>
            <tbody>
              {(
                ["default", "secondary", "destructive", "outline", "ghost", "link"] as const
              ).map((variant) => (
                <tr key={variant} className="align-middle">
                  <td className="py-2 pr-6">
                    <Text size="xs" variant="muted" monospace>
                      {variant}
                    </Text>
                  </td>
                  <td className="py-2 pr-4">
                    <Badge variant={variant}>Label</Badge>
                  </td>
                  <td className="py-2 pr-4">
                    <Badge variant={variant} notchOpts>
                      Label
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Accessibility
        </Heading>
        <div className="max-w-xl space-y-2">
          <Text as="p" size="xs" variant="muted" density="comfortable">
            Badges are rendered as <InlineCode>&lt;span&gt;</InlineCode> by default and are purely
            presentational. Use the <InlineCode>render</InlineCode> prop to change the underlying
            element if the badge needs to be interactive (e.g., a link or button).
          </Text>
        </div>
      </section>
    </>
  ),
};
