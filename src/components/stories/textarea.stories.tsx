import type { Meta, StoryObj } from "@storybook/react";

import { Field, FieldLabel, FieldDescription, FieldError } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

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
        <h2 className="font-mono text-sm font-bold text-foreground">Imports</h2>
        <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
          <code>
            <span className="text-primary">import</span>
            {" { Textarea } "}
            <span className="text-primary">from</span>
            {" '@/components/ui/textarea';"}
          </code>
        </pre>
        <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
          The Textarea component wraps a native{" "}
          <code className="text-primary">&lt;textarea&gt;</code> with design system styling. It uses{" "}
          <code className="text-primary">field-sizing: content</code> to auto-grow with its content,
          and features the same debossed treatment as Input in dark mode.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Basic Usage</h2>
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
        <h2 className="font-mono text-sm font-bold text-foreground">With Field Label</h2>
        <p className="text-xs text-muted-foreground">
          Combine with <code className="text-primary">Field</code> and{" "}
          <code className="text-primary">FieldLabel</code> for a complete form field.
        </p>
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
        <h2 className="font-mono text-sm font-bold text-foreground">Auto-grow</h2>
        <p className="text-xs text-muted-foreground">
          Textarea uses <code className="text-primary">field-sizing: content</code> by default,
          meaning it expands vertically as you type. The minimum height is{" "}
          <code className="text-primary">4rem</code> (64px).
        </p>
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
        <h2 className="font-mono text-sm font-bold text-foreground">Disabled</h2>
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
        <h2 className="font-mono text-sm font-bold text-foreground">Validation / Error State</h2>
        <p className="text-xs text-muted-foreground">
          Use <code className="text-primary">aria-invalid="true"</code> to trigger the destructive
          border styling.
        </p>
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
        <h2 className="font-mono text-sm font-bold text-foreground">Notched Variant</h2>
        <p className="text-xs text-muted-foreground">
          Pass <code className="text-primary">notchOpts</code> to clip corners with a chamfer.
        </p>
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
        <h2 className="font-mono text-sm font-bold text-foreground">With Fixed Height</h2>
        <p className="text-xs text-muted-foreground">
          Override auto-grow with a fixed height using className.
        </p>
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
        <h2 className="font-mono text-sm font-bold text-foreground">Accessibility</h2>
        <div className="max-w-xl space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            Always pair textareas with a visible <code className="text-primary">FieldLabel</code> or
            an <code className="text-primary">aria-label</code> for screen readers.
          </p>
          <p>
            Use <code className="text-primary">aria-invalid</code> and{" "}
            <code className="text-primary">FieldError</code> for validation feedback. The
            destructive ring color is applied automatically when{" "}
            <code className="text-primary">aria-invalid="true"</code>.
          </p>
        </div>
      </section>
    </>
  ),
};
