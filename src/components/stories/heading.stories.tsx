import type { Meta, StoryObj } from "@storybook/react";

import { Heading } from "@/components/ui/typography";

const meta: Meta<typeof Heading> = {
  title: "Typography/Heading",
  component: Heading,
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
type Story = StoryObj<typeof Heading>;

export const Overview: Story = {
  render: () => (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Imports</h2>
        <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
          <code>
            <span className="text-primary">import</span>
            {" { Heading } "}
            <span className="text-primary">from</span>
            {" '@/components/ui/typography';"}
          </code>
        </pre>
        <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
          The Heading component creates semantic heading elements with appropriate default sizes and
          styling. It ensures proper heading hierarchy while providing visual consistency. Use the
          required <code className="text-primary">as</code> prop to specify the semantic heading
          level.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Semantic Heading Levels</h2>
        <p className="text-xs text-muted-foreground">
          Each level has a default size that follows standard typography hierarchy. The{" "}
          <code className="text-primary">as</code> prop is required.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-col gap-3">
            <Heading as="h1">Heading 1</Heading>
            <Heading as="h2">Heading 2</Heading>
            <Heading as="h3">Heading 3</Heading>
            <Heading as="h4">Heading 4</Heading>
            <Heading as="h5">Heading 5</Heading>
            <Heading as="h6">Heading 6</Heading>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Heading as="h1">Heading 1</Heading>   {/* 4xl */}
<Heading as="h2">Heading 2</Heading>   {/* 3xl */}
<Heading as="h3">Heading 3</Heading>   {/* 2xl */}
<Heading as="h4">Heading 4</Heading>   {/* xl  */}
<Heading as="h5">Heading 5</Heading>   {/* lg  */}
<Heading as="h6">Heading 6</Heading>   {/* md  */}`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Custom Sizes</h2>
        <p className="text-xs text-muted-foreground">
          Override the default size with the <code className="text-primary">size</code> prop to
          decouple visual appearance from semantic meaning. Heading supports up to{" "}
          <code className="text-primary">4xl</code>.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-col gap-3">
            <Heading as="h2" size="4xl">
              H2 with 4xl size
            </Heading>
            <Heading as="h1" size="md">
              H1 with medium size
            </Heading>
            <Heading as="h5" size="xl">
              H5 with extra large size
            </Heading>
            <Heading as="h3" size="3xl">
              H3 with 3xl size
            </Heading>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Heading as="h2" size="4xl">H2 with 4xl size</Heading>
<Heading as="h1" size="md">H1 with medium size</Heading>
<Heading as="h5" size="xl">H5 with extra large size</Heading>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Display Font</h2>
        <p className="text-xs text-muted-foreground">
          The <code className="text-primary">display</code> prop switches the font to Space Grotesk,
          the display typeface. Without it, headings use Rubik (the body font). Use display for hero
          headings, marketing text, or anywhere you want a more geometric look.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-col gap-4">
            <div>
              <span className="font-mono text-xs text-muted-foreground">Rubik (default)</span>
              <Heading as="h2">The quick brown fox jumps</Heading>
            </div>
            <div>
              <span className="font-mono text-xs text-muted-foreground">
                Space Grotesk (display)
              </span>
              <Heading as="h2" display>
                The quick brown fox jumps
              </Heading>
            </div>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Heading as="h2">Rubik (default)</Heading>
<Heading as="h2" display>Space Grotesk (display)</Heading>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Variants</h2>
        <p className="text-xs text-muted-foreground">Color variants for headings.</p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-col gap-2">
            {(["primary", "muted", "accent", "success", "warning", "danger"] as const).map(
              (variant) => (
                <Heading key={variant} as="h3" size="lg" variant={variant}>
                  {variant.charAt(0).toUpperCase() + variant.slice(1)} heading
                </Heading>
              ),
            )}
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Heading as="h3" variant="primary">Primary (default)</Heading>
<Heading as="h3" variant="muted">Muted</Heading>
<Heading as="h3" variant="accent">Accent</Heading>
<Heading as="h3" variant="success">Success</Heading>
<Heading as="h3" variant="warning">Warning</Heading>
<Heading as="h3" variant="danger">Danger</Heading>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Typography Features</h2>
        <p className="text-xs text-muted-foreground">
          Headings support italic, underline, strikethrough, and monospace toggles.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-col gap-2">
            <Heading as="h3" size="lg" italic>
              Italic heading
            </Heading>
            <Heading as="h3" size="lg" underline>
              Underlined heading
            </Heading>
            <Heading as="h3" size="lg" strikethrough>
              Strikethrough heading
            </Heading>
            <Heading as="h3" size="lg" monospace>
              Monospace heading
            </Heading>
            <Heading as="h3" size="lg" italic underline>
              Italic underlined heading
            </Heading>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Heading as="h3" italic>Italic</Heading>
<Heading as="h3" underline>Underlined</Heading>
<Heading as="h3" strikethrough>Strikethrough</Heading>
<Heading as="h3" monospace>Monospace</Heading>
<Heading as="h3" italic underline>Combined</Heading>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Text Alignment</h2>
        <p className="text-xs text-muted-foreground">
          Control text alignment with the <code className="text-primary">align</code> prop.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-col gap-3">
            {(["left", "center", "right"] as const).map((align) => (
              <div key={align} className="border border-border/50 p-3">
                <Heading as="h4" align={align}>
                  {align.charAt(0).toUpperCase() + align.slice(1)} aligned heading
                </Heading>
              </div>
            ))}
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Heading as="h4" align="left">Left aligned</Heading>
<Heading as="h4" align="center">Center aligned</Heading>
<Heading as="h4" align="right">Right aligned</Heading>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Ellipsis Overflow</h2>
        <p className="text-xs text-muted-foreground">
          Handle text overflow with the <code className="text-primary">ellipsis</code> prop.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="w-[300px] border border-border/50 p-3">
            <Heading as="h4" ellipsis>
              This is a very long heading that will be truncated with an ellipsis
            </Heading>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Heading as="h4" ellipsis>
  This is a very long heading...
</Heading>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">All Sizes</h2>
        <p className="text-xs text-muted-foreground">
          Complete list of every explicit size value for visual QA.
        </p>
        <div className="overflow-x-auto border border-border bg-card p-8">
          <div className="flex flex-col gap-3">
            {(["4xl", "3xl", "2xl", "xl", "lg", "md", "sm", "xs"] as const).map((size) => (
              <div key={size} className="flex items-baseline gap-4">
                <span className="w-10 font-mono text-xs text-muted-foreground">{size}</span>
                <Heading as="h3" size={size}>
                  The quick brown fox
                </Heading>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Accessibility</h2>
        <div className="max-w-xl space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            The <code className="text-primary">as</code> prop is required to ensure proper semantic
            heading hierarchy. Screen readers use heading levels to build a document outline, so
            always use the correct level for the content hierarchy — don't skip heading levels.
          </p>
          <p>
            Use the <code className="text-primary">size</code> prop to decouple visual appearance
            from semantic meaning when needed.
          </p>
        </div>
      </section>
    </>
  ),
};
