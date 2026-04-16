import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Confirm, ConfirmPortal, openConfirmModal } from "@/components/ui/confirm";
import { Heading, InlineCode, Text } from "@/components/ui/typography";

const meta: Meta<typeof Confirm> = {
  title: "Components/Confirm",
  component: Confirm,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="flex min-w-[600px] flex-col items-start gap-10 bg-background p-12">
        <ConfirmPortal />
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Confirm>;

export const Overview: Story = {
  render: function ConfirmStory() {
    const [lastAction, setLastAction] = useState<string>("");

    return (
      <>
        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Imports
          </Heading>
          <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
            <code>
              <span className="text-primary">import</span>
              {" { Confirm, ConfirmPortal, openConfirmModal } "}
              <span className="text-primary">from</span>
              {" '@/components/ui/confirm';"}
            </code>
          </pre>
          <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
            Two ways to show confirmations: wrap a trigger with{" "}
            <InlineCode>{"<Confirm>"}</InlineCode>, or call{" "}
            <InlineCode>openConfirmModal()</InlineCode> imperatively. For the imperative API, mount{" "}
            <InlineCode>{"<ConfirmPortal />"}</InlineCode> once near your app root.
          </Text>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Wrapper Usage
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Wrap any trigger element with <InlineCode>{"<Confirm>"}</InlineCode>.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex flex-wrap justify-center gap-3">
              <Confirm
                title="Confirm action"
                message="Are you sure you want to proceed?"
                onConfirm={() => setLastAction("Confirmed!")}
              >
                <Button variant="outline">Confirm</Button>
              </Confirm>
              <Confirm
                title="Delete item?"
                message="This action cannot be undone. The item will be permanently removed."
                confirmText="Delete"
                variant="destructive"
                onConfirm={() => setLastAction("Deleted!")}
              >
                <Button variant="destructive">Delete</Button>
              </Confirm>
            </div>
            {lastAction && (
              <Text as="p" size="xs" variant="success">
                Last action: {lastAction}
              </Text>
            )}
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<Confirm
  title="Delete item?"
  message="This cannot be undone."
  confirmText="Delete"
  variant="destructive"
  onConfirm={() => deleteItem()}
>
  <Button variant="destructive">Delete</Button>
</Confirm>`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Imperative API
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Call <InlineCode>openConfirmModal()</InlineCode> from any event handler. Returns a{" "}
            <InlineCode>Promise{"<boolean>"}</InlineCode>.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex flex-wrap justify-center gap-3">
              <Button
                variant="outline"
                onClick={async () => {
                  const confirmed = await openConfirmModal({
                    title: "Publish changes?",
                    message: "Your changes will be visible to all users.",
                  });
                  setLastAction(confirmed ? "Published!" : "Cancelled");
                }}
              >
                Publish
              </Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  const confirmed = await openConfirmModal({
                    title: "Delete project?",
                    message: "This will permanently delete the project and all its data.",
                    confirmText: "Delete Project",
                    variant: "destructive",
                  });
                  setLastAction(confirmed ? "Project deleted!" : "Cancelled");
                }}
              >
                Delete Project
              </Button>
            </div>
            {lastAction && (
              <Text as="p" size="xs" variant="success">
                Result: {lastAction}
              </Text>
            )}
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`const confirmed = await openConfirmModal({
  title: "Delete project?",
  message: "This cannot be undone.",
  variant: "destructive",
});
if (confirmed) await deleteProject();`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Async Confirmation
          </Heading>
          <Text as="p" size="xs" variant="muted">
            When <InlineCode>onConfirm</InlineCode> returns a Promise, the modal stays open with a
            loading spinner until it resolves.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex justify-center">
              <Confirm
                title="Processing..."
                message="This action takes 2 seconds to complete."
                confirmText="Start"
                onConfirm={async () => {
                  await new Promise((r) => setTimeout(r, 2000));
                  setLastAction("Async action complete!");
                }}
              >
                <Button variant="outline">Async Confirm (2s)</Button>
              </Confirm>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Bypass Mode
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Set <InlineCode>bypass</InlineCode> to skip the dialog and run{" "}
            <InlineCode>onConfirm</InlineCode> directly. Useful for conditional confirmations.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex flex-wrap justify-center gap-3">
              <Confirm
                title="This won't show"
                bypass
                onConfirm={() => setLastAction("Bypassed — ran directly!")}
              >
                <Button variant="outline">Bypass (no dialog)</Button>
              </Confirm>
              <Confirm
                title="Normal confirmation"
                onConfirm={() => setLastAction("Normal confirm")}
              >
                <Button variant="outline">Normal (shows dialog)</Button>
              </Confirm>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Custom Labels
          </Heading>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex justify-center">
              <Confirm
                title="Discard changes?"
                message="You have unsaved changes that will be lost."
                confirmText="Discard"
                cancelText="Keep Editing"
                variant="destructive"
                onConfirm={() => setLastAction("Discarded!")}
              >
                <Button variant="outline">Custom Labels</Button>
              </Confirm>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Accessibility
          </Heading>
          <div className="max-w-xl space-y-2">
            <Text as="p" size="xs" variant="muted" density="comfortable">
              Built on our AlertDialog which uses Base UI's Alert Dialog with proper ARIA semantics.
              Focus is trapped inside the dialog. Escape closes it. The cancel button is focused by
              default for safety.
            </Text>
          </div>
        </section>
      </>
    );
  },
};
