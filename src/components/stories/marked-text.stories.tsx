import type { Meta, StoryObj } from "@storybook/react";

import { MarkedText, Text } from "@/components/ui/typography";

const meta: Meta<typeof MarkedText> = {
  title: "Typography/MarkedText",
  component: MarkedText,
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
type Story = StoryObj<typeof MarkedText>;

export const Overview: Story = {
  render: () => (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Imports</h2>
        <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
          <code>
            <span className="text-primary">import</span>
            {" { MarkedText } "}
            <span className="text-primary">from</span>
            {" '@/components/ui/typography';"}
          </code>
        </pre>
        <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
          The MarkedText component renders sanitized markdown text. It uses{" "}
          <code className="text-primary">marked</code> for parsing and{" "}
          <code className="text-primary">dompurify</code> for sanitization. It supports polymorphism
          via the <code className="text-primary">as</code> prop and forwards refs correctly.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Default</h2>
        <p className="text-xs text-muted-foreground">
          By default, MarkedText renders as a <code className="text-primary">{"<div>"}</code> and
          processes markdown including paragraphs, bold, italic, and more.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <MarkedText>{"This is **bold** and *italic* text"}</MarkedText>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<MarkedText>{"This is **bold** and *italic* text"}</MarkedText>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Inline Markdown</h2>
        <p className="text-xs text-muted-foreground">
          Use the <code className="text-primary">inline</code> prop to control whether markdown is
          parsed as inline content (no wrapping <code className="text-primary">{"<p>"}</code> tags).
          This is useful for embedding markdown within other text elements.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-col gap-3">
            <div>
              <Text variant="muted" size="xs">
                Block (default):
              </Text>
              <MarkedText>{"This is **bold** and *italic* text"}</MarkedText>
            </div>
            <div>
              <Text variant="muted" size="xs">
                Inline:
              </Text>
              <MarkedText as="span" inline>
                {"This is **bold** and *italic* text"}
              </MarkedText>
            </div>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`{/* Block: wraps in <p> tags */}
<MarkedText>{"This is **bold** and *italic*"}</MarkedText>

{/* Inline: no <p> wrapping */}
<MarkedText as="span" inline>
  {"This is **bold** and *italic*"}
</MarkedText>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Custom Element</h2>
        <p className="text-xs text-muted-foreground">
          The <code className="text-primary">as</code> prop can be used to specify the element type
          to render as. Supports <code className="text-primary">p</code>,{" "}
          <code className="text-primary">span</code>, <code className="text-primary">div</code>, and
          heading elements.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-col gap-3">
            <MarkedText as="h3" inline className="text-xl font-bold tracking-tight">
              {"This is a **heading**"}
            </MarkedText>
            <MarkedText as="p">{"This is a **paragraph** element"}</MarkedText>
            <MarkedText as="span" inline>
              {"This is a **span** element"}
            </MarkedText>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<MarkedText as="h3" inline>{"This is a **heading**"}</MarkedText>
<MarkedText as="p">{"This is a **paragraph**"}</MarkedText>
<MarkedText as="span" inline>{"This is a **span**"}</MarkedText>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">With Link</h2>
        <p className="text-xs text-muted-foreground">
          Markdown links are supported and styled with the accent color.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <MarkedText>
            {"This is a [link to Brackeys](https://brackeys.community) in markdown."}
          </MarkedText>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<MarkedText>
  {"This is a [link](https://brackeys.community) in markdown."}
</MarkedText>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">With List</h2>
        <p className="text-xs text-muted-foreground">
          Markdown lists are supported with proper styling.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <MarkedText>
            {`Shopping list:

- Item 1
- Item 2
- Item 3

Steps to follow:

1. First step
2. Second step
3. Third step`}
          </MarkedText>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<MarkedText>{\`
- Item 1
- Item 2
- Item 3
\`}</MarkedText>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">With Code Block</h2>
        <p className="text-xs text-muted-foreground">
          Markdown code blocks are supported with proper styling. Inline code and fenced code blocks
          both work.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <MarkedText>
            {`Use the \`useState\` hook for state management.

\`\`\`
const example = "code block";
console.log(example);
const el = <Component>Hello</Component>;
\`\`\``}
          </MarkedText>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<MarkedText>{\`
Use the \\\`useState\\\` hook.

\\\`\\\`\\\`
const example = "code block";
\\\`\\\`\\\`
\`}</MarkedText>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">With Blockquote</h2>
        <p className="text-xs text-muted-foreground">
          Markdown blockquotes render with accent border styling.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <MarkedText>
            {`As the saying goes:

> Any sufficiently advanced technology is indistinguishable from magic.

This remains true today.`}
          </MarkedText>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<MarkedText>{\`
> Any sufficiently advanced technology...
\`}</MarkedText>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Full Markdown Document</h2>
        <p className="text-xs text-muted-foreground">
          A complete markdown document showing all supported features together.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <MarkedText>
            {`# Welcome to Brackeys

This is a **full markdown document** rendered by the \`MarkedText\` component.

## Features

The component supports:

- **Bold** and *italic* text
- [Links](https://brackeys.community) with proper styling
- Inline \`code\` and code blocks
- Lists (ordered and unordered)
- Blockquotes

## Code Example

\`\`\`
import { MarkedText } from "@/components/ui/typography";

function App() {
  return <MarkedText>{"# Hello World"}</MarkedText>;
}
\`\`\`

## Quote

> The best way to predict the future is to invent it.

---

Built with [marked](https://marked.js.org/) and sanitized with [DOMPurify](https://github.com/cure53/DOMPurify).`}
          </MarkedText>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Security</h2>
        <div className="max-w-xl space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            All markdown output is sanitized via <code className="text-primary">DOMPurify</code>{" "}
            before rendering with <code className="text-primary">dangerouslySetInnerHTML</code>.
            This prevents XSS attacks from user-provided markdown content. Script tags, event
            handlers, and other potentially dangerous HTML are stripped automatically.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Accessibility</h2>
        <div className="max-w-xl space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            MarkedText renders semantic HTML from markdown, preserving heading hierarchy, list
            structure, and link semantics. The <code className="text-primary">as</code> prop lets
            you choose the correct wrapper element for your context.
          </p>
        </div>
      </section>
    </>
  ),
};
