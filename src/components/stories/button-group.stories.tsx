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
        <h2 className="font-mono text-sm font-bold text-foreground">Imports</h2>
        <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
          <code>
            <span className="text-primary">import</span>
            {" { ButtonGroup, ButtonGroupText, ButtonGroupSeparator } "}
            <span className="text-primary">from</span>
            {" '@/components/ui/button-group';"}
          </code>
        </pre>
        <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
          ButtonGroup is used to create merged button layouts where buttons are visually joined
          together with shared borders and no gaps between them, creating a cohesive control unit.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-sm font-bold text-foreground">Usage</h2>
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
        <h2 className="font-mono text-sm font-bold text-foreground">Orientation</h2>
        <p className="text-xs text-muted-foreground">
          Use <code className="text-primary">orientation="vertical"</code> to stack buttons
          vertically with joined borders.
        </p>
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
        <h2 className="font-mono text-sm font-bold text-foreground">Icon Toolbar</h2>
        <p className="text-xs text-muted-foreground">
          Combine icon-only buttons for compact toolbars like text formatting controls.
        </p>
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
        <h2 className="font-mono text-sm font-bold text-foreground">With Text Label</h2>
        <p className="text-xs text-muted-foreground">
          Use <code className="text-primary">ButtonGroupText</code> to add a non-interactive label
          segment within the group.
        </p>
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
        <h2 className="font-mono text-sm font-bold text-foreground">With Separator</h2>
        <p className="text-xs text-muted-foreground">
          Use <code className="text-primary">ButtonGroupSeparator</code> to add a visual divider
          between button segments.
        </p>
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
        <h2 className="font-mono text-sm font-bold text-foreground">Notched Ends</h2>
        <p className="text-xs text-muted-foreground">
          Pass <code className="text-primary">notchOpts</code> to the first and last buttons to
          notch only the outer edges of the group.
        </p>
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
        <h2 className="font-mono text-sm font-bold text-foreground">Notes</h2>
        <div className="max-w-xl space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            ButtonGroup is a purely presentational component. It does not manage any internal state
            such as which button is active or selected. Handle selection state in your parent
            component and pass the appropriate props (like{" "}
            <code className="text-primary">variant="default"</code>) to the active button.
          </p>
          <p>
            Buttons within a group have reduced emboss lift to prevent shadow overlap between
            adjacent elements.
          </p>
        </div>
      </section>
    </>
  ),
};
