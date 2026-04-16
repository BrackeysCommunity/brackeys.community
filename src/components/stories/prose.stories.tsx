import type { Meta, StoryObj } from "@storybook/react";

import { Prose } from "@/components/ui/typography";

const meta: Meta<typeof Prose> = {
  title: "Typography/Prose",
  component: Prose,
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
type Story = StoryObj<typeof Prose>;

export const Overview: Story = {
  render: () => (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Imports</h2>
        <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
          <code>
            <span className="text-primary">import</span>
            {" { Prose } "}
            <span className="text-primary">from</span>
            {" '@/components/ui/typography';"}
          </code>
        </pre>
        <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
          Prose provides consistent spacing and typography for rich text content. It automatically
          styles headings, paragraphs, lists, links, code, blockquotes, and horizontal rules using
          descendant selectors. Use plain HTML inside and get nice styles.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Basic Usage</h2>
        <p className="text-xs text-muted-foreground">
          Wrap any rich text content in <code className="text-primary">{"<Prose>"}</code> to get
          consistent spacing and typography.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <Prose>
            <h2>Getting Started</h2>
            <p>
              This is a paragraph of text that demonstrates how the Prose component automatically
              applies consistent spacing between prose elements.
            </p>
            <p>
              Multiple paragraphs maintain proper spacing, making content easy to read and visually
              appealing.
            </p>
            <h3>Features</h3>
            <ul>
              <li>Automatic spacing between elements</li>
              <li>Support for all prose elements</li>
              <li>Consistent typography</li>
              <li>
                Use plain <code>html</code> and get nice styles
              </li>
            </ul>
          </Prose>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Prose>
  <h2>Getting Started</h2>
  <p>This is a paragraph of text...</p>
  <h3>Features</h3>
  <ul>
    <li>Automatic spacing</li>
    <li>Use plain <code>html</code></li>
  </ul>
</Prose>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Headings</h2>
        <p className="text-xs text-muted-foreground">
          All six heading levels are supported with decreasing sizes and proper margins.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <Prose>
            <h1>Heading 1</h1>
            <p>Paragraph after h1.</p>
            <h2>Heading 2</h2>
            <p>Paragraph after h2.</p>
            <h3>Heading 3</h3>
            <p>Paragraph after h3.</p>
            <h4>Heading 4</h4>
            <p>Paragraph after h4.</p>
            <h5>Heading 5</h5>
            <p>Paragraph after h5.</p>
            <h6>Heading 6</h6>
            <p>Paragraph after h6.</p>
          </Prose>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Lists</h2>
        <p className="text-xs text-muted-foreground">
          Both unordered and ordered lists are styled with proper indentation and markers.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <Prose>
            <h3>Unordered List</h3>
            <ul>
              <li>First item</li>
              <li>Second item with more text to show wrapping behavior</li>
              <li>Third item</li>
            </ul>
            <h3>Ordered List</h3>
            <ol>
              <li>Step one: Install dependencies</li>
              <li>Step two: Configure the project</li>
              <li>Step three: Start the dev server</li>
            </ol>
          </Prose>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Prose>
  <ul>
    <li>Unordered item</li>
  </ul>
  <ol>
    <li>Ordered item</li>
  </ol>
</Prose>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Links</h2>
        <p className="text-xs text-muted-foreground">
          Links are styled with the accent color and underline.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <Prose>
            <p>
              Check out the <a href="https://brackeys.community">Brackeys Community</a> for more
              information. You can also visit the{" "}
              <a href="https://discord.gg/brackeys">Discord server</a> to chat with other members.
            </p>
          </Prose>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Prose>
  <p>
    Check out the <a href="...">Brackeys</a> for more info.
  </p>
</Prose>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Inline Code</h2>
        <p className="text-xs text-muted-foreground">
          Inline <code className="text-primary">{"<code>"}</code> elements are automatically styled
          within Prose, matching the InlineCode component's visual language.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <Prose>
            <p>
              To initialize a new React component, you'll need to import <code>React</code> from the{" "}
              <code>react</code> package. Then define your component using either the{" "}
              <code>function</code> keyword or as an arrow function.
            </p>
            <p>
              Remember to export your component using <code>export default MyComponent</code> so it
              can be imported elsewhere in your application.
            </p>
          </Prose>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Code Blocks</h2>
        <p className="text-xs text-muted-foreground">
          Pre-formatted code blocks get a card background and proper overflow handling. Nested{" "}
          <code className="text-primary">{"<code>"}</code> inside{" "}
          <code className="text-primary">{"<pre>"}</code> resets to inherit.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <Prose>
            <p>Here's an example configuration:</p>
            <pre>
              <code>{`const config = {
  theme: "brackeys",
  fonts: {
    body: "Rubik",
    display: "Space Grotesk",
    mono: "JetBrains Mono",
  },
};`}</code>
            </pre>
            <p>This will set up the typography system for your project.</p>
          </Prose>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Blockquotes</h2>
        <p className="text-xs text-muted-foreground">
          Blockquotes are styled with a left accent border and italic text.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <Prose>
            <p>As the saying goes:</p>
            <blockquote>
              <p>Any sufficiently advanced technology is indistinguishable from magic.</p>
            </blockquote>
            <p>This remains true in software engineering.</p>
          </Prose>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Horizontal Rules</h2>
        <p className="text-xs text-muted-foreground">
          Horizontal rules provide visual separation between sections.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <Prose>
            <p>Content above the rule.</p>
            <hr />
            <p>Content below the rule.</p>
          </Prose>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Emphasis</h2>
        <p className="text-xs text-muted-foreground">
          Strong and emphasis elements are styled appropriately.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <Prose>
            <p>
              This is <strong>bold text</strong> and this is <em>italic text</em>. You can also
              combine them for{" "}
              <strong>
                <em>bold italic text</em>
              </strong>
              .
            </p>
          </Prose>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Full Article Example</h2>
        <p className="text-xs text-muted-foreground">
          A complete article demonstrating all prose elements working together.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <Prose>
            <h1>Building a Design System</h1>
            <p>
              A design system is a collection of <strong>reusable components</strong>, guided by{" "}
              <em>clear standards</em>, that can be assembled together to build any number of
              applications.
            </p>

            <h2>Why Design Systems Matter</h2>
            <p>
              Design systems help teams build better products faster. They provide a shared language
              between designers and developers, reducing ambiguity and improving consistency.
            </p>
            <blockquote>
              <p>A design system is not a project. It's a product, serving products.</p>
            </blockquote>

            <h2>Key Components</h2>
            <p>Every design system should include:</p>
            <ol>
              <li>
                <strong>Typography</strong> — A scale of font sizes and weights
              </li>
              <li>
                <strong>Color</strong> — A palette with semantic meaning
              </li>
              <li>
                <strong>Spacing</strong> — Consistent margins and padding
              </li>
              <li>
                <strong>Components</strong> — Reusable UI building blocks
              </li>
            </ol>

            <h3>Getting Started</h3>
            <p>
              Start by installing the package via <code>npm install</code> or using the{" "}
              <code>vp add</code> command:
            </p>
            <pre>
              <code>{`vp add @brackeys/ui`}</code>
            </pre>
            <p>
              Then import the components you need. See the{" "}
              <a href="https://brackeys.community/docs">documentation</a> for a full list of
              available components.
            </p>

            <hr />

            <h2>Further Reading</h2>
            <ul>
              <li>
                <a href="https://brackeys.community">Brackeys Community</a>
              </li>
              <li>Component API Reference</li>
              <li>Theming Guide</li>
            </ul>
          </Prose>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Accessibility</h2>
        <div className="max-w-xl space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            Prose relies on semantic HTML elements for proper accessibility. Use heading levels
            correctly (don't skip levels), provide meaningful link text, and use{" "}
            <code className="text-primary">{"<strong>"}</code> and{" "}
            <code className="text-primary">{"<em>"}</code> for emphasis rather than presentational
            bold/italic.
          </p>
        </div>
      </section>
    </>
  ),
};
