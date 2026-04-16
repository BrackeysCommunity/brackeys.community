import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormField, FormGroup, FormSubmit } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Heading, InlineCode, Text } from "@/components/ui/typography";
import { useFormConfig } from "@/lib/hooks/use-form-config";

const meta: Meta<typeof Form> = {
  title: "Forms/Form",
  component: Form,
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
type Story = StoryObj<typeof Form>;

const quickStartSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.email("Please enter a valid email"),
});

const fullSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.email("Please enter a valid email"),
  bio: z.string().max(500, "Bio must be under 500 characters").optional(),
  plan: z.string().min(1, "Please select a plan"),
  notifications: z.boolean().optional(),
  terms: z.boolean().optional(),
});

export const Overview: Story = {
  render: function FormStory() {
    const [submitted, setSubmitted] = useState<Record<string, unknown> | null>(null);

    const quickForm = useFormConfig({
      schema: quickStartSchema,
      defaultValues: { name: "", email: "" },
      onSubmit: async (values) => {
        await new Promise((r) => setTimeout(r, 1000));
        setSubmitted(values);
      },
    });

    const fullForm = useFormConfig({
      schema: fullSchema,
      defaultValues: {
        firstName: "",
        lastName: "",
        email: "",
        bio: "",
        plan: "",
        notifications: true,
        terms: false,
      },
      onSubmit: async (values) => {
        await new Promise((r) => setTimeout(r, 1500));
        setSubmitted(values);
      },
    });

    return (
      <>
        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Imports
          </Heading>
          <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
            <code>
              <span className="text-primary">import</span>
              {" { Form, FormField, FormSubmit, FormGroup } "}
              <span className="text-primary">from</span>
              {" '@/components/ui/form';\n"}
              <span className="text-primary">import</span>
              {" { useFormConfig } "}
              <span className="text-primary">from</span>
              {" '@/lib/hooks/use-form-config';"}
            </code>
          </pre>
          <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
            A form system built on TanStack React Form and Zod. Use{" "}
            <InlineCode>useFormConfig</InlineCode> to create a form with our default validation
            strategy (validate on submit, revalidate on change), then compose with{" "}
            <InlineCode>{"<Form>"}</InlineCode>, <InlineCode>{"<FormField>"}</InlineCode>, and{" "}
            <InlineCode>{"<FormSubmit>"}</InlineCode>.
          </Text>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Quick Start
          </Heading>
          <Text as="p" size="xs" variant="muted">
            A minimal form with Zod validation and submission.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <Form form={quickForm} className="w-full max-w-sm">
              <FormField name="name" label="Name" required>
                {(field: {
                  state: { value: string };
                  handleChange: (v: string) => void;
                  handleBlur: () => void;
                }) => (
                  <Input
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="Your name"
                  />
                )}
              </FormField>
              <FormField name="email" label="Email" required>
                {(field: {
                  state: { value: string };
                  handleChange: (v: string) => void;
                  handleBlur: () => void;
                }) => (
                  <Input
                    type="email"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder="you@example.com"
                  />
                )}
              </FormField>
              <FormSubmit>Submit</FormSubmit>
            </Form>
            {submitted && (
              <pre className="border-t border-border pt-4 font-mono text-xs text-success">
                Submitted: {JSON.stringify(submitted, null, 2)}
              </pre>
            )}
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email'),
});

const form = useFormConfig({
  schema,
  defaultValues: { name: '', email: '' },
  onSubmit: async (values) => { ... },
});

<Form form={form}>
  <FormField name="name" label="Name" required>
    {(field) => <Input ... />}
  </FormField>
  <FormSubmit>Submit</FormSubmit>
</Form>`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Layouts
          </Heading>
          <Text as="p" size="xs" variant="muted">
            <InlineCode>layout="stack"</InlineCode> (default) puts label above.{" "}
            <InlineCode>layout="row"</InlineCode> puts label on the left for settings pages.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <Form form={quickForm} className="w-full max-w-md">
              <FormField name="name" label="Stack Layout (default)" hint="Label above the field">
                {(field: { state: { value: string }; handleChange: (v: string) => void }) => (
                  <Input
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                )}
              </FormField>
              <FormField name="email" label="Row Layout" layout="row" hint="Label on the left">
                {(field: { state: { value: string }; handleChange: (v: string) => void }) => (
                  <Input
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                )}
              </FormField>
            </Form>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Field Groups
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Group related fields into titled sections.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <Form form={fullForm} className="w-full max-w-md">
              <FormGroup title="Personal Information">
                <FormField name="firstName" label="First Name" required>
                  {(field: { state: { value: string }; handleChange: (v: string) => void }) => (
                    <Input
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  )}
                </FormField>
                <FormField name="lastName" label="Last Name" required>
                  {(field: { state: { value: string }; handleChange: (v: string) => void }) => (
                    <Input
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  )}
                </FormField>
              </FormGroup>
              <FormGroup title="Contact">
                <FormField name="email" label="Email" required>
                  {(field: { state: { value: string }; handleChange: (v: string) => void }) => (
                    <Input
                      type="email"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  )}
                </FormField>
                <FormField name="bio" label="Bio" hint="Tell us about yourself">
                  {(field: { state: { value: string }; handleChange: (v: string) => void }) => (
                    <Textarea
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  )}
                </FormField>
              </FormGroup>
              <FormGroup title="Preferences">
                <FormField name="notifications" label="Email Notifications" layout="row">
                  {(field: { state: { value: boolean }; handleChange: (v: boolean) => void }) => (
                    <Switch checked={field.state.value} onCheckedChange={field.handleChange} />
                  )}
                </FormField>
                <FormField name="terms" label="Accept Terms" layout="row">
                  {(field: { state: { value: boolean }; handleChange: (v: boolean) => void }) => (
                    <Checkbox checked={field.state.value} onCheckedChange={field.handleChange} />
                  )}
                </FormField>
              </FormGroup>
              <div className="flex justify-end gap-2">
                <Button variant="outline" type="button" onClick={() => fullForm.reset()}>
                  Reset
                </Button>
                <FormSubmit>Save Changes</FormSubmit>
              </div>
            </Form>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Notched Fields
          </Heading>
          <Text as="p" size="xs" variant="muted">
            All form inputs support the <InlineCode>notchOpts</InlineCode> prop for chamfered
            corners.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <Form form={quickForm} className="w-full max-w-sm">
              <FormField name="name" label="Name (notched)" required>
                {(field: { state: { value: string }; handleChange: (v: string) => void }) => (
                  <Input
                    notchOpts
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Notched input"
                  />
                )}
              </FormField>
              <FormField name="email" label="Email (notched)" required>
                {(field: { state: { value: string }; handleChange: (v: string) => void }) => (
                  <Input
                    notchOpts={{ corners: ["tl", "br"] }}
                    type="email"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Custom notch corners"
                  />
                )}
              </FormField>
              <FormSubmit notchOpts>Submit (notched)</FormSubmit>
            </Form>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            All Field Types
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Every field type working with <InlineCode>FormField</InlineCode>.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <Form form={fullForm} className="w-full max-w-md">
              <FormField name="firstName" label="Text Input" required>
                {(field: { state: { value: string }; handleChange: (v: string) => void }) => (
                  <Input
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Regular text"
                  />
                )}
              </FormField>
              <FormField name="email" label="Email Input" required>
                {(field: { state: { value: string }; handleChange: (v: string) => void }) => (
                  <Input
                    type="email"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="email@example.com"
                  />
                )}
              </FormField>
              <FormField name="bio" label="Textarea">
                {(field: { state: { value: string }; handleChange: (v: string) => void }) => (
                  <Textarea
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Tell us about yourself..."
                  />
                )}
              </FormField>
              <FormField name="notifications" label="Switch" layout="row">
                {(field: { state: { value: boolean }; handleChange: (v: boolean) => void }) => (
                  <Switch checked={field.state.value} onCheckedChange={field.handleChange} />
                )}
              </FormField>
              <FormField name="terms" label="Checkbox" layout="row">
                {(field: { state: { value: boolean }; handleChange: (v: boolean) => void }) => (
                  <Checkbox checked={field.state.value} onCheckedChange={field.handleChange} />
                )}
              </FormField>
            </Form>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Accessibility
          </Heading>
          <div className="max-w-xl space-y-2">
            <Text as="p" size="xs" variant="muted" density="comfortable">
              Forms use semantic <InlineCode>{"<form>"}</InlineCode> and{" "}
              <InlineCode>{"<fieldset>"}</InlineCode> elements. Field labels are connected to inputs
              via our <InlineCode>Field</InlineCode>/<InlineCode>FieldLabel</InlineCode> primitives.
              Validation errors are rendered with <InlineCode>role="alert"</InlineCode> for screen
              reader announcements.
            </Text>
          </div>
        </section>
      </>
    );
  },
};
