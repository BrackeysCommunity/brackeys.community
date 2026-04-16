import type { Meta, StoryObj } from "@storybook/react";

import { InlineCode } from "@/components/ui/typography";
import { Text } from "@/components/ui/typography";

const meta: Meta<typeof InlineCode> = {
  title: "Typography/InlineCode",
  component: InlineCode,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="flex max-w-3xl min-w-[700px] flex-col items-start gap-10 bg-background p-12">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof InlineCode>;

export const Overview: Story = {
  render: () => (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Imports</h2>
        <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
          <code>
            <span className="text-primary">import</span>
            {" { InlineCode } "}
            <span className="text-primary">from</span>
            {" '@/components/ui/typography';"}
          </code>
        </pre>
        <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
          InlineCode provides styling for short snippets of code within text content, such as
          variable names, function calls, CSS properties, and file paths. It renders a semantic{" "}
          <code className="text-primary">{"<code>"}</code> element and uses relative{" "}
          <code className="text-primary">em</code> sizing so it scales with its parent text.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Basic Usage</h2>
        <p className="text-xs text-muted-foreground">
          Use to highlight code elements within sentences or paragraphs.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <Text as="p">
            The <InlineCode>console.log()</InlineCode> function outputs messages to the browser
            console.
          </Text>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Text as="p">
  The <InlineCode>console.log()</InlineCode> function outputs
  messages to the browser console.
</Text>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Variants</h2>
        <p className="text-xs text-muted-foreground">
          Use <code className="text-primary">variant="neutral"</code> for headings or situations
          where the vibrancy of the default would be distracting.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <span className="w-16 font-mono text-xs text-muted-foreground">default</span>
              <Text>
                Use the <InlineCode>useState</InlineCode> hook
              </Text>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-16 font-mono text-xs text-muted-foreground">neutral</span>
              <Text>
                Use the <InlineCode variant="neutral">useState</InlineCode> hook
              </Text>
            </div>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<InlineCode>useState</InlineCode>              {/* accent tint */}
<InlineCode variant="neutral">useState</InlineCode>  {/* muted bg */}`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Scaling with Text Sizes</h2>
        <p className="text-xs text-muted-foreground">
          InlineCode uses <code className="text-primary">text-[0.9em]</code> sizing, so it
          automatically scales relative to its parent text size.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-col gap-3">
            {(["xs", "sm", "md", "lg", "xl", "2xl"] as const).map((size) => (
              <div key={size} className="flex items-baseline gap-3">
                <span className="w-8 font-mono text-xs text-muted-foreground">{size}</span>
                <Text size={size}>
                  Use <InlineCode>useState</InlineCode> for state
                </Text>
              </div>
            ))}
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Text size="xs">Use <InlineCode>useState</InlineCode></Text>
<Text size="lg">Use <InlineCode>useState</InlineCode></Text>
<Text size="2xl">Use <InlineCode>useState</InlineCode></Text>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">In Headings</h2>
        <p className="text-xs text-muted-foreground">
          InlineCode can be used inside headings. The neutral variant works well here.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-col gap-3">
            <h3 className="text-xl font-bold tracking-tight text-foreground">
              Hello <InlineCode variant="neutral">:user</InlineCode>
            </h3>
            <h3 className="text-lg font-bold tracking-tight text-foreground">
              The <InlineCode variant="neutral">useEffect</InlineCode> Hook
            </h3>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Heading as="h3">
  Hello <InlineCode variant="neutral">:user</InlineCode>
</Heading>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Common Use Cases</h2>
        <p className="text-xs text-muted-foreground">
          InlineCode is perfect for marking up various code-related content within prose.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <ul className="flex flex-col gap-2 text-sm text-foreground">
            <li>
              Variable names: <InlineCode>userName</InlineCode> or{" "}
              <InlineCode>isLoading</InlineCode>
            </li>
            <li>
              Function names: <InlineCode>handleSubmit()</InlineCode> or{" "}
              <InlineCode>fetchData()</InlineCode>
            </li>
            <li>
              CSS properties: <InlineCode>display: flex</InlineCode> or{" "}
              <InlineCode>margin: 0</InlineCode>
            </li>
            <li>
              File paths: <InlineCode>/src/components/Button.tsx</InlineCode>
            </li>
            <li>
              Package names: <InlineCode>@sentry/react</InlineCode> or{" "}
              <InlineCode>lodash</InlineCode>
            </li>
            <li>
              HTML attributes: <InlineCode>className</InlineCode> or{" "}
              <InlineCode>onClick</InlineCode>
            </li>
          </ul>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`Variable names: <InlineCode>userName</InlineCode>
Function names: <InlineCode>handleSubmit()</InlineCode>
CSS properties: <InlineCode>display: flex</InlineCode>
File paths: <InlineCode>/src/components/Button.tsx</InlineCode>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Related Components</h2>
        <div className="max-w-xl space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>For different code display needs, consider these alternatives:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <code className="text-primary">{"<Prose>"}</code>: Use for long-form content that may
              contain code elements (auto-styles <code className="text-primary">{"<code>"}</code>{" "}
              tags)
            </li>
            <li>
              <code className="text-primary">{"<Text monospace>"}</code>: Use for monospace text
              that isn't necessarily code
            </li>
            <li>
              <code className="text-primary">{"<MarkedText>"}</code>: Use for rendering markdown
              that includes code blocks
            </li>
          </ul>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Accessibility</h2>
        <div className="max-w-xl space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            InlineCode renders as a semantic <code className="text-primary">{"<code>"}</code>{" "}
            element, which provides appropriate meaning to screen readers and other assistive
            technologies.
          </p>
        </div>
      </section>
    </>
  ),
};
