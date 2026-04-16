import type { Meta, StoryObj } from "@storybook/react";
import { z } from "zod";

import { AutoSaveField } from "@/components/ui/auto-save-field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Heading, InlineCode, Text } from "@/components/ui/typography";

const meta: Meta<typeof AutoSaveField> = {
  title: "Forms/AutoSaveField",
  component: AutoSaveField,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="flex max-w-2xl min-w-[600px] flex-col items-start gap-10 bg-background p-12">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AutoSaveField>;

const userSchema = z.object({
  displayName: z.string().min(1, "Display name is required"),
  bio: z.string().max(500, "Bio must be under 500 characters"),
  notifications: z.boolean(),
});

const simulateSave = async (data: Record<string, unknown>) => {
  await new Promise((r) => setTimeout(r, 800));
  console.log("Saved:", data);
};

const simulateFailure = async () => {
  await new Promise((r) => setTimeout(r, 800));
  throw new Error("Network error: could not save");
};

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
            {" { AutoSaveField } "}
            <span className="text-primary">from</span>
            {" '@/components/ui/auto-save-field';"}
          </code>
        </pre>
        <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
          A standalone auto-save field for settings pages. Each{" "}
          <InlineCode>AutoSaveField</InlineCode> creates its own form instance — there's no shared
          form, no submit button, and no form-level submission. Fields save on blur (input/textarea)
          and show inline status indicators.
        </Text>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Basic Usage
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Type in the field, then click away (blur) to trigger auto-save.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="w-full max-w-sm">
            <AutoSaveField
              name="displayName"
              schema={userSchema}
              initialValue="Joshua"
              onSave={simulateSave}
              label="Display Name"
              required
            >
              {(field: { state: { value: string }; handleChange: (v: string) => void }) => (
                <Input
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              )}
            </AutoSaveField>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<AutoSaveField
  name="displayName"
  schema={schema}
  initialValue="Joshua"
  onSave={async (data) => mutation.mutateAsync(data)}
  label="Display Name"
  required
>
  {(field) => <Input value={field.state.value} onChange={...} />}
</AutoSaveField>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Row Layout
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Use <InlineCode>layout="row"</InlineCode> for settings pages.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex w-full max-w-md flex-col gap-4">
            <AutoSaveField
              name="displayName"
              schema={userSchema}
              initialValue="Joshua"
              onSave={simulateSave}
              label="Display Name"
              layout="row"
              required
            >
              {(field: { state: { value: string }; handleChange: (v: string) => void }) => (
                <Input
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              )}
            </AutoSaveField>
            <AutoSaveField
              name="notifications"
              schema={userSchema}
              initialValue={true}
              onSave={simulateSave}
              label="Email Notifications"
              layout="row"
            >
              {(field: { state: { value: boolean }; handleChange: (v: boolean) => void }) => (
                <Switch
                  checked={field.state.value}
                  onCheckedChange={(val) => {
                    field.handleChange(val);
                  }}
                />
              )}
            </AutoSaveField>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Textarea
        </Heading>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="w-full max-w-sm">
            <AutoSaveField
              name="bio"
              schema={userSchema}
              initialValue="A passionate developer."
              onSave={simulateSave}
              label="Bio"
              hint="Tell us about yourself"
            >
              {(field: { state: { value: string }; handleChange: (v: string) => void }) => (
                <Textarea
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              )}
            </AutoSaveField>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Error State
        </Heading>
        <Text as="p" size="xs" variant="muted">
          When the save fails, a warning icon appears with the error in a tooltip.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="w-full max-w-sm">
            <AutoSaveField
              name="displayName"
              schema={userSchema}
              initialValue="Joshua"
              onSave={simulateFailure}
              label="Display Name (will fail)"
            >
              {(field: { state: { value: string }; handleChange: (v: string) => void }) => (
                <Input
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              )}
            </AutoSaveField>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Status Indicators
        </Heading>
        <div className="max-w-xl space-y-2">
          <Text as="p" size="xs" variant="muted" density="comfortable">
            AutoSaveField shows inline status next to the field:
          </Text>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>
              <strong>Spinner</strong> — while saving (mutation pending)
            </li>
            <li>
              <strong>Checkmark</strong> — on success (fades after 2 seconds)
            </li>
            <li>
              <strong>Warning icon</strong> — on error (tooltip shows message)
            </li>
          </ul>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Confirmation Dialogs
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Use the <InlineCode>confirm</InlineCode> prop for dangerous operations.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="w-full max-w-sm">
            <AutoSaveField
              name="displayName"
              schema={userSchema}
              initialValue="Joshua"
              onSave={simulateSave}
              label="Display Name (with confirm)"
              confirm="Are you sure you want to change your display name?"
            >
              {(field: { state: { value: string }; handleChange: (v: string) => void }) => (
                <Input
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              )}
            </AutoSaveField>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<AutoSaveField
  confirm="Are you sure?"
  {...otherProps}
>
  ...
</AutoSaveField>

// Conditional confirm:
<AutoSaveField
  confirm={(value) => value ? 'Enable?' : undefined}
  {...otherProps}
>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Accessibility
        </Heading>
        <div className="max-w-xl space-y-2">
          <Text as="p" size="xs" variant="muted" density="comfortable">
            Each auto-save field uses our <InlineCode>Field</InlineCode>/
            <InlineCode>FieldLabel</InlineCode> primitives for proper label association. Status
            indicators use <InlineCode>aria-label</InlineCode> for screen readers. Error tooltips
            are keyboard accessible.
          </Text>
        </div>
      </section>
    </>
  ),
};
