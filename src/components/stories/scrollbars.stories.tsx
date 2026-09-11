import type { Meta, StoryObj } from "@storybook/react";

import { Textarea } from "@/components/ui/textarea";
import { Heading, InlineCode, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";

/**
 * Exists to be snapshotted, not read.
 *
 * The house scrollbar styling only renders on platforms that draw classic,
 * space-taking scrollbars — Windows, Linux, and macOS with "Show scroll
 * bars: Always". On a default Mac they are overlay bars, so the styling is
 * invisible locally and no amount of clicking around proves anything.
 * Chromatic renders in Linux Chrome, which is the classic path, so these
 * panels are where a regression actually shows up.
 */
const meta: Meta = {
  title: "Foundations/Scrollbars",
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="flex max-w-4xl min-w-[600px] flex-col items-start gap-10 bg-background p-12">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj;

/** Enough lines to overflow every panel below at its fixed height. */
function Filler({ lines = 30 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: lines }, (_, i) => (
        <Text key={i} size="sm" variant="muted">
          Line {i + 1} — a scroll container needs content taller than its box before it has anything
          to say.
        </Text>
      ))}
    </div>
  );
}

export const Overview: Story = {
  render: () => (
    <>
      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm">
          Why this story exists
        </Heading>
        <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
          Every nested scroller used to draw the platform's own scrollbar: invisible on macOS, where
          they are overlay bars, and a wide light rectangle on Windows. The base layer now styles
          them instead of hiding them — a modal body taller than its box still has to say so, and on
          Windows the bar was the only thing saying it.
        </Text>
        <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
          On a default Mac these panels look unstyled, because overlay scrollbars take no layout
          space and ignore the rules. To see them locally, set{" "}
          <InlineCode>System Settings → Appearance → Show scroll bars</InlineCode> to{" "}
          <InlineCode>Always</InlineCode>. Chromatic renders in Linux Chrome, which always draws the
          classic bar, so the snapshot is the real check.
        </Text>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm">
          Vertical — the modal-body case
        </Heading>
        <Text as="p" size="xs" variant="muted">
          The wizard's body, the tag picker's result list, and the moderation shell's panel are all
          this shape.
        </Text>
        <Well className="h-64 w-full overflow-y-auto p-4">
          <Filler />
        </Well>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm">
          Both axes, and the corner
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Where two bars meet, <InlineCode>::-webkit-scrollbar-corner</InlineCode> keeps the joint
          transparent rather than a grey square.
        </Text>
        <Well className="h-64 w-full overflow-auto p-4">
          <div className="w-[1200px]">
            <Filler />
          </div>
        </Well>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm">
          Form controls
        </Heading>
        <Text as="p" size="xs" variant="muted">
          A native <InlineCode>&lt;textarea&gt;</InlineCode> draws its own bar, which the{" "}
          <InlineCode>.no-scrollbar</InlineCode> utility never covered — this was filed twice, the
          second time against the report dialog.
        </Text>
        <Textarea
          className="h-40 w-full"
          readOnly
          value={Array.from({ length: 30 }, (_, i) => `Line ${i + 1} of a long report body.`).join(
            "\n",
          )}
        />
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm">
          The opt-out still opts out
        </Heading>
        <Text as="p" size="xs" variant="muted">
          <InlineCode>.no-scrollbar</InlineCode> is excluded from the base rule, so the command
          palette, combobox and menu popups keep a clipped edge as their affordance instead of a
          gutter. This panel scrolls with no visible bar on any platform.
        </Text>
        <Well className="no-scrollbar h-64 w-full overflow-y-auto p-4">
          <Filler />
        </Well>
      </section>
    </>
  ),
};
