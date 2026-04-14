import {
  TextBoldIcon,
  TextItalicIcon,
  TextUnderlineIcon,
  AlignLeftIcon,
  AlignHorizontalCenterIcon,
  AlignRightIcon,
  Add01Icon,
  Remove01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Meta, StoryObj } from "@storybook/react";

import { Button } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupText, ButtonGroupSeparator } from "@/components/ui/button-group";
import { Heading, Text, InlineCode } from "@/components/ui/typography";

const meta: Meta<typeof ButtonGroup> = {
  title: "Components/ButtonGroup",
  component: ButtonGroup,
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
type Story = StoryObj<typeof ButtonGroup>;

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
            {" { ButtonGroup, ButtonGroupText, ButtonGroupSeparator } "}
            <span className="text-primary">from</span>
            {" '@/components/ui/button-group';"}
          </code>
        </pre>
        <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
          ButtonGroup is used to create merged button layouts where buttons are visually joined
          together with shared borders and no gaps between them, creating a cohesive control unit.
        </Text>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Usage
        </Heading>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex justify-center">
            <ButtonGroup>
              <Button variant="outline">One</Button>
              <Button variant="outline">Two</Button>
              <Button variant="outline">Three</Button>
            </ButtonGroup>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<ButtonGroup>
  <Button variant="outline">One</Button>
  <Button variant="outline">Two</Button>
  <Button variant="outline">Three</Button>
</ButtonGroup>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Orientation
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Use <InlineCode>orientation="vertical"</InlineCode> to stack buttons vertically with
          joined borders.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex justify-center">
            <ButtonGroup orientation="vertical">
              <Button variant="outline">One</Button>
              <Button variant="outline">Two</Button>
              <Button variant="outline">Three</Button>
            </ButtonGroup>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<ButtonGroup orientation="vertical">
  <Button variant="outline">One</Button>
  <Button variant="outline">Two</Button>
  <Button variant="outline">Three</Button>
</ButtonGroup>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Icon Toolbar
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Combine icon-only buttons for compact toolbars like text formatting controls.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex items-center justify-center gap-4">
            <ButtonGroup>
              <Button variant="outline" size="icon-sm">
                <HugeiconsIcon icon={TextBoldIcon} />
              </Button>
              <Button variant="outline" size="icon-sm">
                <HugeiconsIcon icon={TextItalicIcon} />
              </Button>
              <Button variant="outline" size="icon-sm">
                <HugeiconsIcon icon={TextUnderlineIcon} />
              </Button>
            </ButtonGroup>
            <ButtonGroup>
              <Button variant="outline" size="icon-sm">
                <HugeiconsIcon icon={AlignLeftIcon} />
              </Button>
              <Button variant="outline" size="icon-sm">
                <HugeiconsIcon icon={AlignHorizontalCenterIcon} />
              </Button>
              <Button variant="outline" size="icon-sm">
                <HugeiconsIcon icon={AlignRightIcon} />
              </Button>
            </ButtonGroup>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<ButtonGroup>
  <Button variant="outline" size="icon-sm">
    <HugeiconsIcon icon={TextBoldIcon} />
  </Button>
  <Button variant="outline" size="icon-sm">
    <HugeiconsIcon icon={TextItalicIcon} />
  </Button>
  <Button variant="outline" size="icon-sm">
    <HugeiconsIcon icon={TextUnderlineIcon} />
  </Button>
</ButtonGroup>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          With Text Label
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Use <InlineCode>ButtonGroupText</InlineCode> to add a non-interactive label segment within
          the group.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex justify-center">
            <ButtonGroup>
              <Button variant="outline" size="icon-sm">
                <HugeiconsIcon icon={Remove01Icon} />
              </Button>
              <ButtonGroupText>12</ButtonGroupText>
              <Button variant="outline" size="icon-sm">
                <HugeiconsIcon icon={Add01Icon} />
              </Button>
            </ButtonGroup>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<ButtonGroup>
  <Button variant="outline" size="icon-sm">
    <HugeiconsIcon icon={Remove01Icon} />
  </Button>
  <ButtonGroupText>12</ButtonGroupText>
  <Button variant="outline" size="icon-sm">
    <HugeiconsIcon icon={Add01Icon} />
  </Button>
</ButtonGroup>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          With Separator
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Use <InlineCode>ButtonGroupSeparator</InlineCode> to add a visual divider between button
          segments.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex justify-center">
            <ButtonGroup>
              <Button variant="outline">Save</Button>
              <ButtonGroupSeparator />
              <Button variant="outline">Save As</Button>
            </ButtonGroup>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<ButtonGroup>
  <Button variant="outline">Save</Button>
  <ButtonGroupSeparator />
  <Button variant="outline">Save As</Button>
</ButtonGroup>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Notched Ends
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Pass <InlineCode>notchOpts</InlineCode> to the first and last buttons to notch only the
          outer edges of the group.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex justify-center">
            <ButtonGroup>
              <Button variant="outline" notchOpts={{ corners: ["tl", "bl"] }}>
                One
              </Button>
              <Button variant="outline">Two</Button>
              <Button variant="outline" notchOpts={{ corners: ["tr", "br"] }}>
                Three
              </Button>
            </ButtonGroup>
          </div>
          <div className="flex justify-center">
            <ButtonGroup orientation="vertical">
              <Button variant="outline" notchOpts={{ corners: ["tl", "tr"] }}>
                One
              </Button>
              <Button variant="outline">Two</Button>
              <Button variant="outline" notchOpts={{ corners: ["bl", "br"] }}>
                Three
              </Button>
            </ButtonGroup>
          </div>
          <div className="flex justify-center">
            <ButtonGroup>
              <Button variant="outline" notchOpts={{ size: 10, corners: ["tl"] }}>
                Left
              </Button>
              <Button variant="outline">Center</Button>
              <Button variant="outline" notchOpts={{ size: 10, corners: ["br"] }}>
                Right
              </Button>
            </ButtonGroup>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<ButtonGroup>
  <Button variant="outline" notchOpts={{ corners: ["tl", "bl"] }}>One</Button>
  <Button variant="outline">Two</Button>
  <Button variant="outline" notchOpts={{ corners: ["tr", "br"] }}>Three</Button>
</ButtonGroup>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Notes
        </Heading>
        <div className="max-w-xl space-y-2">
          <Text as="p" size="xs" variant="muted" density="comfortable">
            ButtonGroup is a purely presentational component. It does not manage any internal state
            such as which button is active or selected. Handle selection state in your parent
            component and pass the appropriate props (like{" "}
            <InlineCode>variant="default"</InlineCode>) to the active button.
          </Text>
          <Text as="p" size="xs" variant="muted" density="comfortable">
            Buttons within a group have reduced emboss lift to prevent shadow overlap between
            adjacent elements.
          </Text>
        </div>
      </section>
    </>
  ),
};
