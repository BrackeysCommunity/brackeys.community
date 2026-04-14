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
import { Heading, Text, InlineCode } from "@/components/ui/typography";

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
        <Heading as="h2" size="sm" monospace>
          Imports
        </Heading>
        <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
          <code>
            <span className="text-primary">import</span>
            {" { Input } "}
            <span className="text-primary">from</span>
            {" '@/components/ui/input';"}
          </code>
        </pre>
        <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
          The Input component wraps a native <InlineCode>&lt;input&gt;</InlineCode> with the
          Brackeys design system styling. It features a debossed (sunken) appearance in dark mode
          for visual depth, consistent with the sci-fi aesthetic.
        </Text>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Basic Usage
        </Heading>
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
        <Heading as="h2" size="sm" monospace>
          Input Types
        </Heading>
        <Text as="p" size="xs" variant="muted">
          All native HTML input types are supported. The component passes through the{" "}
          <InlineCode>type</InlineCode> prop directly.
        </Text>
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
        <Heading as="h2" size="sm" monospace>
          With Field Labels
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Combine with <InlineCode>Field</InlineCode>, <InlineCode>FieldLabel</InlineCode>, and{" "}
          <InlineCode>FieldDescription</InlineCode> for complete form fields.
        </Text>
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
        <Heading as="h2" size="sm" monospace>
          Disabled
        </Heading>
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
        <Heading as="h2" size="sm" monospace>
          Validation / Error State
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Use <InlineCode>aria-invalid="true"</InlineCode> to show the error state border. Pair with{" "}
          <InlineCode>FieldError</InlineCode> for the message.
        </Text>
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
        <Heading as="h2" size="sm" monospace>
          InputGroup
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Use <InlineCode>InputGroup</InlineCode> to add icons, text, buttons, or keyboard shortcuts
          alongside the input.
        </Text>
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
        <Heading as="h2" size="sm" monospace>
          Notched Variant
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Pass <InlineCode>notchOpts</InlineCode> to clip corners with a chamfer.
        </Text>
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
        <Heading as="h2" size="sm" monospace>
          File Input
        </Heading>
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
        <Heading as="h2" size="sm" monospace>
          Accessibility
        </Heading>
        <div className="max-w-xl space-y-2">
          <Text as="p" size="xs" variant="muted" density="comfortable">
            Input is built on <InlineCode>@base-ui/react/input</InlineCode> which provides proper
            ARIA semantics and focus management.
          </Text>
          <Text as="p" size="xs" variant="muted" density="comfortable">
            Always pair inputs with a visible <InlineCode>FieldLabel</InlineCode> or an{" "}
            <InlineCode>aria-label</InlineCode> for screen readers. Use{" "}
            <InlineCode>aria-invalid</InlineCode> and <InlineCode>FieldError</InlineCode> for
            validation feedback.
          </Text>
        </div>
      </section>
    </>
  ),
};
