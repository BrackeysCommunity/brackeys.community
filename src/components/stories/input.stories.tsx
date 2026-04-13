import { Search01Icon, Mail01Icon, LockIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Meta, StoryObj } from "@storybook/react";

import { Field, FieldLabel, FieldDescription, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupButton,
} from "@/components/ui/input-group";
import { Kbd } from "@/components/ui/kbd";

const meta: Meta<typeof Input> = {
  title: "Components/Input",
  component: Input,
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
type Story = StoryObj<typeof Input>;

export const Overview: Story = {
  render: () => (
    <>
      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Imports</h2>
        <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
          <code>
            <span className="text-primary">import</span>
            {" { Input } "}
            <span className="text-primary">from</span>
            {" '@/components/ui/input';"}
          </code>
        </pre>
        <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
          The Input component wraps a native <code className="text-primary">&lt;input&gt;</code>{" "}
          with the Brackeys design system styling. It features a debossed (sunken) appearance in
          dark mode for visual depth, consistent with the sci-fi aesthetic.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Basic Usage</h2>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
            <Input placeholder="Enter your name..." />
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Input placeholder="Enter your name..." />`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Input Types</h2>
        <p className="text-xs text-muted-foreground">
          All native HTML input types are supported. The component passes through the{" "}
          <code className="text-primary">type</code> prop directly.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
            <Input type="text" placeholder="Text input" />
            <Input type="email" placeholder="email@example.com" />
            <Input type="password" placeholder="Password" />
            <Input type="number" placeholder="0" />
            <Input type="search" placeholder="Search..." />
            <Input type="url" placeholder="https://..." />
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Input type="text" placeholder="Text input" />
<Input type="email" placeholder="email@example.com" />
<Input type="password" placeholder="Password" />
<Input type="number" placeholder="0" />
<Input type="search" placeholder="Search..." />
<Input type="url" placeholder="https://..." />`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">With Field Labels</h2>
        <p className="text-xs text-muted-foreground">
          Combine with <code className="text-primary">Field</code>,{" "}
          <code className="text-primary">FieldLabel</code>, and{" "}
          <code className="text-primary">FieldDescription</code> for complete form fields.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="mx-auto flex w-full max-w-sm flex-col gap-5">
            <Field>
              <FieldLabel>Email</FieldLabel>
              <Input type="email" placeholder="you@example.com" />
              <FieldDescription>We'll never share your email.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Username</FieldLabel>
              <Input placeholder="brackeys_fan" />
            </Field>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Field>
  <FieldLabel>Email</FieldLabel>
  <Input type="email" placeholder="you@example.com" />
  <FieldDescription>We'll never share your email.</FieldDescription>
</Field>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Disabled</h2>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
            <Input disabled placeholder="Disabled input" />
            <Input disabled value="Disabled with value" />
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Input disabled placeholder="Disabled input" />
<Input disabled value="Disabled with value" />`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Validation / Error State</h2>
        <p className="text-xs text-muted-foreground">
          Use <code className="text-primary">aria-invalid="true"</code> to show the error state
          border. Pair with <code className="text-primary">FieldError</code> for the message.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="mx-auto flex w-full max-w-sm flex-col gap-5">
            <Field>
              <FieldLabel>Username</FieldLabel>
              <Input aria-invalid="true" defaultValue="ab" />
              <FieldError>Username must be at least 3 characters.</FieldError>
            </Field>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Field>
  <FieldLabel>Username</FieldLabel>
  <Input aria-invalid="true" defaultValue="ab" />
  <FieldError>Username must be at least 3 characters.</FieldError>
</Field>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">InputGroup</h2>
        <p className="text-xs text-muted-foreground">
          Use <code className="text-primary">InputGroup</code> to add icons, text, buttons, or
          keyboard shortcuts alongside the input.
        </p>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
            <InputGroup>
              <InputGroupAddon align="inline-start">
                <HugeiconsIcon icon={Search01Icon} />
              </InputGroupAddon>
              <InputGroupInput placeholder="Search..." />
              <InputGroupAddon align="inline-end">
                <Kbd>ESC</Kbd>
              </InputGroupAddon>
            </InputGroup>

            <InputGroup>
              <InputGroupAddon align="inline-start">
                <HugeiconsIcon icon={Mail01Icon} />
              </InputGroupAddon>
              <InputGroupInput type="email" placeholder="Email address" />
            </InputGroup>

            <InputGroup>
              <InputGroupAddon align="inline-start">
                <HugeiconsIcon icon={LockIcon} />
              </InputGroupAddon>
              <InputGroupInput type="password" placeholder="Password" />
              <InputGroupAddon align="inline-end">
                <InputGroupButton variant="ghost" size="xs">
                  Show
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<InputGroup>
  <InputGroupAddon align="inline-start">
    <HugeiconsIcon icon={Search01Icon} />
  </InputGroupAddon>
  <InputGroupInput placeholder="Search..." />
  <InputGroupAddon align="inline-end">
    <Kbd>ESC</Kbd>
  </InputGroupAddon>
</InputGroup>`}
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
            <Input notchOpts placeholder="Default notch (tr + bl)" />
            <Input notchOpts={{ corners: ["tl", "br"] }} placeholder="Custom corners" />
            <Input notchOpts={{ size: 10, corners: ["tr", "bl"] }} placeholder="Larger notch" />
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Input notchOpts placeholder="Default notch (tr + bl)" />
<Input notchOpts={{ corners: ["tl", "br"] }} placeholder="Custom corners" />
<Input notchOpts={{ size: 10 }} placeholder="Larger notch" />`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">File Input</h2>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
            <Input type="file" />
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Input type="file" />`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Accessibility</h2>
        <div className="max-w-xl space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            Input is built on <code className="text-primary">@base-ui/react/input</code> which
            provides proper ARIA semantics and focus management.
          </p>
          <p>
            Always pair inputs with a visible <code className="text-primary">FieldLabel</code> or an{" "}
            <code className="text-primary">aria-label</code> for screen readers. Use{" "}
            <code className="text-primary">aria-invalid</code> and{" "}
            <code className="text-primary">FieldError</code> for validation feedback.
          </p>
        </div>
      </section>
    </>
  ),
};
