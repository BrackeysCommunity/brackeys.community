import type { Meta, StoryObj } from "@storybook/react";

import { Field, FieldLabel, FieldDescription, FieldError } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Heading, Text, InlineCode } from "@/components/ui/typography";

const meta: Meta<typeof Textarea> = {
  title: "Components/Textarea",
  component: Textarea,
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
type Story = StoryObj<typeof Textarea>;

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
            {" { Textarea } "}
            <span className="text-primary">from</span>
            {" '@/components/ui/textarea';"}
          </code>
        </pre>
        <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
          The Textarea component wraps a native <InlineCode>&lt;textarea&gt;</InlineCode> with
          design system styling. It uses <InlineCode>field-sizing: content</InlineCode> to auto-grow
          with its content, and features the same debossed treatment as Input in dark mode.
        </Text>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Basic Usage
        </Heading>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="mx-auto w-full max-w-sm">
            <Textarea placeholder="Write something..." />
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Textarea placeholder="Write something..." />`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          With Field Label
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Combine with <InlineCode>Field</InlineCode> and <InlineCode>FieldLabel</InlineCode> for a
          complete form field.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="mx-auto flex w-full max-w-sm flex-col gap-5">
            <Field>
              <FieldLabel>Description</FieldLabel>
              <Textarea placeholder="Tell us about your project..." />
              <FieldDescription>Markdown is supported.</FieldDescription>
            </Field>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Field>
  <FieldLabel>Description</FieldLabel>
  <Textarea placeholder="Tell us about your project..." />
  <FieldDescription>Markdown is supported.</FieldDescription>
</Field>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Auto-grow
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Textarea uses <InlineCode>field-sizing: content</InlineCode> by default, meaning it
          expands vertically as you type. The minimum height is <InlineCode>4rem</InlineCode>{" "}
          (64px).
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="mx-auto w-full max-w-sm">
            <Textarea
              defaultValue={`This textarea will grow as content is added.\n\nTry adding more lines to see it expand automatically without a scrollbar appearing.`}
            />
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Textarea defaultValue="This textarea will grow..." />`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Disabled
        </Heading>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
            <Textarea disabled placeholder="Disabled textarea" />
            <Textarea disabled defaultValue="Disabled with content that cannot be edited." />
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Textarea disabled placeholder="Disabled textarea" />
<Textarea disabled defaultValue="Disabled with content." />`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Validation / Error State
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Use <InlineCode>aria-invalid="true"</InlineCode> to trigger the destructive border
          styling.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="mx-auto flex w-full max-w-sm flex-col gap-5">
            <Field>
              <FieldLabel>Bio</FieldLabel>
              <Textarea aria-invalid="true" defaultValue="Hi" />
              <FieldError>Bio must be at least 20 characters.</FieldError>
            </Field>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Field>
  <FieldLabel>Bio</FieldLabel>
  <Textarea aria-invalid="true" defaultValue="Hi" />
  <FieldError>Bio must be at least 20 characters.</FieldError>
</Field>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Notched Variant
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Pass <InlineCode>notchOpts</InlineCode> to clip corners with a chamfer.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
            <Textarea notchOpts placeholder="Default notch (tr + bl)" />
            <Textarea notchOpts={{ corners: ["tl", "br"], size: 10 }} placeholder="Custom notch" />
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Textarea notchOpts placeholder="Default notch (tr + bl)" />
<Textarea notchOpts={{ corners: ["tl", "br"], size: 10 }} placeholder="Custom" />`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          With Fixed Height
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Override auto-grow with a fixed height using className.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="mx-auto w-full max-w-sm">
            <Textarea
              className="field-sizing-fixed h-32"
              placeholder="Fixed height textarea with scroll..."
            />
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Textarea
  className="h-32 field-sizing-fixed"
  placeholder="Fixed height textarea with scroll..."
/>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Accessibility
        </Heading>
        <div className="max-w-xl space-y-2">
          <Text as="p" size="xs" variant="muted" density="comfortable">
            Always pair textareas with a visible <InlineCode>FieldLabel</InlineCode> or an{" "}
            <InlineCode>aria-label</InlineCode> for screen readers.
          </Text>
          <Text as="p" size="xs" variant="muted" density="comfortable">
            Use <InlineCode>aria-invalid</InlineCode> and <InlineCode>FieldError</InlineCode> for
            validation feedback. The destructive ring color is applied automatically when{" "}
            <InlineCode>aria-invalid="true"</InlineCode>.
          </Text>
        </div>
      </section>
    </>
  ),
};
