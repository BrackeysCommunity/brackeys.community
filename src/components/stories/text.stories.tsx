import type { Meta, StoryObj } from "@storybook/react";

import { Text } from "@/components/ui/typography";

const meta: Meta<typeof Text> = {
  title: "Typography/Text",
  component: Text,
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
type Story = StoryObj<typeof Text>;

export const Overview: Story = {
  render: () => (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Imports</h2>
        <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
          <code>
            <span className="text-primary">import</span>
            {" { Text } "}
            <span className="text-primary">from</span>
            {" '@/components/ui/typography';"}
          </code>
        </pre>
        <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
          The Text component displays text content with various typography options and styling
          controls. It renders as a <code className="text-primary">{"<span>"}</code> by default but
          can be rendered as a <code className="text-primary">{"<p>"}</code> or{" "}
          <code className="text-primary">{"<div>"}</code> via the{" "}
          <code className="text-primary">as</code> prop.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Basic Usage</h2>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <Text>This is basic text content</Text>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Text>This is basic text content</Text>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Sizes</h2>
        <p className="text-xs text-muted-foreground">
          Text components support different sizes: <code className="text-primary">xs</code>,{" "}
          <code className="text-primary">sm</code>, <code className="text-primary">md</code>{" "}
          (default), <code className="text-primary">lg</code>,{" "}
          <code className="text-primary">xl</code>, and <code className="text-primary">2xl</code>.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-col gap-3">
            {(["2xl", "xl", "lg", "md", "sm", "xs"] as const).map((size) => (
              <div key={size} className="flex items-baseline gap-3">
                <span className="w-8 font-mono text-xs text-muted-foreground">{size}</span>
                <Text size={size}>The quick brown fox jumps over the lazy dog</Text>
              </div>
            ))}
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Text size="2xl">Extra extra large text</Text>
<Text size="xl">Extra large text</Text>
<Text size="lg">Large text</Text>
<Text size="md">Medium text (default)</Text>
<Text size="sm">Small text</Text>
<Text size="xs">Extra small text</Text>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Variants</h2>
        <p className="text-xs text-muted-foreground">
          Color variants control the text color. Maps to the project's design token system.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-col gap-2">
            {(
              ["primary", "muted", "accent", "success", "warning", "danger", "inherit"] as const
            ).map((variant) => (
              <div key={variant} className="flex items-center gap-3">
                <span className="w-16 font-mono text-xs text-muted-foreground">{variant}</span>
                <Text variant={variant}>{variant} text</Text>
              </div>
            ))}
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Text variant="primary">Primary text (default)</Text>
<Text variant="muted">Muted text</Text>
<Text variant="accent">Accent text</Text>
<Text variant="success">Success text</Text>
<Text variant="warning">Warning text</Text>
<Text variant="danger">Danger text</Text>
<Text variant="inherit">Inherit text (inherits from parent)</Text>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">
          Custom Elements with as Prop
        </h2>
        <p className="text-xs text-muted-foreground">
          The Text component can be rendered as different HTML elements using the{" "}
          <code className="text-primary">as</code> prop.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-col gap-2">
            <Text as="p">Text rendered as a paragraph element</Text>
            <Text as="span">Text rendered as a span element</Text>
            <Text as="div">Text rendered as a div element</Text>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Text as="p">Paragraph element</Text>
<Text as="span">Span element</Text>
<Text as="div">Div element</Text>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Typographic Features</h2>
        <p className="text-xs text-muted-foreground">
          Text supports various typography toggles including bold, italic, underline, and
          strikethrough. These can be combined.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-col gap-2">
            <Text bold>Bold text</Text>
            <Text italic>Italic text</Text>
            <Text underline>Underlined text</Text>
            <Text strikethrough>Strikethrough text</Text>
            <Text bold italic underline>
              Bold italic underlined text
            </Text>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Text bold>Bold text</Text>
<Text italic>Italic text</Text>
<Text underline>Underlined text</Text>
<Text strikethrough>Strikethrough text</Text>
<Text bold italic underline>Bold italic underlined text</Text>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Text Alignment</h2>
        <p className="text-xs text-muted-foreground">
          Control text alignment with the <code className="text-primary">align</code> prop.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-col gap-4">
            {(["left", "center", "right", "justify"] as const).map((align) => (
              <div key={align} className="border border-border/50 p-3">
                <Text as="p" align={align}>
                  {align === "justify"
                    ? "Justified text that will wrap to multiple lines and be justified across the full width of the container, distributing space evenly between words."
                    : `${align.charAt(0).toUpperCase() + align.slice(1)} aligned text`}
                </Text>
              </div>
            ))}
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Text align="left">Left aligned</Text>
<Text align="center">Center aligned</Text>
<Text align="right">Right aligned</Text>
<Text align="justify">Justified text...</Text>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Density</h2>
        <p className="text-xs text-muted-foreground">
          Control line height with the <code className="text-primary">density</code> prop:{" "}
          <code className="text-primary">compressed</code>,{" "}
          <code className="text-primary">default</code>, or{" "}
          <code className="text-primary">comfortable</code>.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          {(["compressed", "default", "comfortable"] as const).map((density) => (
            <div key={density}>
              <Text as="p" variant="muted" size="xs" bold>
                {density}
              </Text>
              <Text as="p" density={density}>
                Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor
                incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud
                exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
              </Text>
            </div>
          ))}
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Text density="compressed">Tight line height</Text>
<Text>Default density</Text>
<Text density="comfortable">Relaxed line height</Text>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Ellipsis Overflow</h2>
        <p className="text-xs text-muted-foreground">
          Handle text overflow with the <code className="text-primary">ellipsis</code> prop.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="w-[200px] border border-border/50 p-3">
            <Text ellipsis>
              This is a very long text that will be truncated with an ellipsis when it overflows
            </Text>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Text ellipsis>
  This is a very long text that will be truncated
</Text>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Wrapping</h2>
        <p className="text-xs text-muted-foreground">
          Use <code className="text-primary">textWrap</code> and{" "}
          <code className="text-primary">wordBreak</code> to control wrapping behavior.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex gap-6">
            <div className="w-[200px] border border-border/50 p-3">
              <Text as="p" variant="muted" size="xs" bold>
                break-word
              </Text>
              <Text as="p" wordBreak="break-word">
                https://example.com/path/?param1=value1&amp;param2=some-very-long-value-here
              </Text>
            </div>
            <div className="w-[200px] border border-border/50 p-3">
              <Text as="p" variant="muted" size="xs" bold>
                balance
              </Text>
              <Text as="p" textWrap="balance">
                Balanced text wrapping for a string of words of varying lengths
              </Text>
            </div>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Text wordBreak="break-word">Long URL...</Text>
<Text textWrap="balance">Balanced wrapping...</Text>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Monospace</h2>
        <p className="text-xs text-muted-foreground">
          Use <code className="text-primary">monospace</code> for fixed-width text.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-col gap-1">
            <Text>1234567890 Regular</Text>
            <Text monospace>1234567890 Monospace</Text>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Text>1234567890 Regular</Text>
<Text monospace>1234567890 Monospace</Text>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Font Features</h2>
        <p className="text-xs text-muted-foreground">
          Use <code className="text-primary">tabular</code> for consistent number alignment and{" "}
          <code className="text-primary">fraction</code> for diagonal fraction display.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-col gap-2">
            <div>
              <Text variant="muted" size="xs">
                Tabular nums:
              </Text>
              <div className="flex flex-col">
                <Text tabular>1,234.56</Text>
                <Text tabular>12,345.67</Text>
                <Text tabular>123.45</Text>
              </div>
            </div>
            <div>
              <Text variant="muted" size="xs">
                Fractions:
              </Text>
              <div className="flex gap-3">
                <Text>1/2 3/4 5/8</Text>
                <Text fraction>1/2 3/4 5/8</Text>
              </div>
            </div>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Text tabular>1,234.56</Text>
<Text fraction>1/2 3/4 5/8</Text>`}
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
                {(["xs", "sm", "md", "lg", "xl", "2xl"] as const).map((size) => (
                  <th key={size} className="pr-4 pb-4">
                    {size}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(["primary", "muted", "accent", "success", "warning", "danger"] as const).map(
                (variant) => (
                  <tr key={variant} className="align-baseline">
                    <td className="py-2 pr-6 font-mono text-xs text-muted-foreground">{variant}</td>
                    {(["xs", "sm", "md", "lg", "xl", "2xl"] as const).map((size) => (
                      <td key={size} className="py-2 pr-4">
                        <Text variant={variant} size={size}>
                          Aa
                        </Text>
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
        <h2 className="font-mono text-sm font-bold text-foreground">Accessibility</h2>
        <div className="max-w-xl space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            Text components automatically meet WCAG 2.2 AA compliance for color contrast. Use the{" "}
            <code className="text-primary">as</code> prop to ensure proper semantic HTML. For
            headings, use the <code className="text-primary">{"<Heading>"}</code> component instead.
          </p>
        </div>
      </section>
    </>
  ),
};
