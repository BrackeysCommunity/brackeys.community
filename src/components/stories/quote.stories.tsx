import type { Meta, StoryObj } from "@storybook/react";

import { Quote } from "@/components/ui/typography";

const meta: Meta<typeof Quote> = {
  title: "Typography/Quote",
  component: Quote,
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
type Story = StoryObj<typeof Quote>;

export const Overview: Story = {
  render: () => (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Imports</h2>
        <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
          <code>
            <span className="text-primary">import</span>
            {" { Quote } "}
            <span className="text-primary">from</span>
            {" '@/components/ui/typography';"}
          </code>
        </pre>
        <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
          A blockquote component for displaying extended quotations with optional source attribution
          and citations. Renders semantic HTML with proper{" "}
          <code className="text-primary">{"<figure>"}</code>,{" "}
          <code className="text-primary">{"<blockquote>"}</code>, and{" "}
          <code className="text-primary">{"<cite>"}</code> elements.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Basic Usage</h2>
        <p className="text-xs text-muted-foreground">A simple quotation without attribution.</p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <Quote>It's not a bug; it's an undocumented feature.</Quote>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Quote>
  It's not a bug; it's an undocumented feature.
</Quote>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">With Author</h2>
        <p className="text-xs text-muted-foreground">
          Provide attribution to a specific person or entity via the{" "}
          <code className="text-primary">source</code> prop.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <Quote source={{ author: "Developer" }}>It's not a bug, it's a feature.</Quote>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Quote source={{ author: 'Developer' }}>
  It's not a bug, it's a feature.
</Quote>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">With Author and Label</h2>
        <p className="text-xs text-muted-foreground">
          Include both the author and additional context about the source.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <Quote source={{ author: "Developer", label: "in complete denial" }}>
            It's not a bug, it's a feature.
          </Quote>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Quote
  source={{
    author: 'Developer',
    label: 'in complete denial',
  }}
>
  It's not a bug, it's a feature.
</Quote>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">With URL Reference</h2>
        <p className="text-xs text-muted-foreground">
          The <code className="text-primary">href</code> property provides a machine-readable source
          reference via the <code className="text-primary">{"<cite>"}</code> element.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <Quote
            source={{
              author: "Developer",
              label: "in complete denial",
              href: "https://example.com/source",
            }}
          >
            It's not a bug, it's a feature.
          </Quote>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Quote
  source={{
    author: 'Developer',
    label: 'in complete denial',
    href: 'https://example.com/source',
  }}
>
  It's not a bug, it's a feature.
</Quote>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Long Quotation</h2>
        <p className="text-xs text-muted-foreground">Quotes work well with longer content too.</p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <Quote
            source={{
              author: "Linus Torvalds",
            }}
          >
            Software is like sex: it's better when it's free. Talk is cheap. Show me the code. Most
            good programmers do programming not because they expect to get paid or get adulation by
            the public, but because it is fun to program.
          </Quote>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Multiple Quotes</h2>
        <p className="text-xs text-muted-foreground">
          Quotes stack naturally with consistent spacing.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-col">
            <Quote source={{ author: "Alan Turing" }}>
              We can only see a short distance ahead, but we can see plenty there that needs to be
              done.
            </Quote>
            <Quote source={{ author: "Grace Hopper" }}>
              The most damaging phrase in the language is: 'It's always been done that way.'
            </Quote>
            <Quote source={{ author: "Edsger Dijkstra" }}>
              If debugging is the process of removing bugs, then programming must be the process of
              putting them in.
            </Quote>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Accessibility</h2>
        <div className="max-w-xl space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            Quote uses semantic HTML to ensure quotes are correctly announced by assistive
            technologies. The <code className="text-primary">{"<figure>"}</code> wraps the{" "}
            <code className="text-primary">{"<blockquote>"}</code> and{" "}
            <code className="text-primary">{"<figcaption>"}</code>, and the{" "}
            <code className="text-primary">{"<cite>"}</code> element provides a machine-readable
            source reference.
          </p>
        </div>
      </section>
    </>
  ),
};
