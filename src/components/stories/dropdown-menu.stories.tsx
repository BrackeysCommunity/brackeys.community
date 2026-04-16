import {
  Copy01Icon,
  Delete02Icon,
  Download04Icon,
  Edit02Icon,
  Logout03Icon,
  Mail01Icon,
  Settings01Icon,
  Share01Icon,
  UserAdd01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Heading, InlineCode, Text } from "@/components/ui/typography";

const meta: Meta<typeof DropdownMenu> = {
  title: "Components/DropdownMenu",
  component: DropdownMenu,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="flex min-w-[600px] flex-col items-start gap-10 bg-background p-12">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof DropdownMenu>;

export const Overview: Story = {
  render: function DropdownMenuStory() {
    const [showStatusBar, setShowStatusBar] = useState(true);
    const [showPanel, setShowPanel] = useState(false);
    const [sortBy, setSortBy] = useState("date");

    return (
      <>
        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Imports
          </Heading>
          <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
            <code>
              <span className="text-primary">import</span>
              {" { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,"}
              <br />
              {"  DropdownMenuItem, DropdownMenuSeparator, ... } "}
              <span className="text-primary">from</span>
              {" '@/components/ui/dropdown-menu';"}
            </code>
          </pre>
          <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
            A dropdown menu component built on Base UI's Menu primitive. Supports actions with
            icons, grouped sections, checkbox/radio items, submenus, keyboard shortcuts, and
            destructive variants.
          </Text>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Basic Actions
          </Heading>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex justify-center">
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline">Actions</Button>} />
                <DropdownMenuContent>
                  <DropdownMenuItem>
                    <HugeiconsIcon icon={Edit02Icon} />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <HugeiconsIcon icon={Copy01Icon} />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <HugeiconsIcon icon={Share01Icon} />
                    Share
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive">
                    <HugeiconsIcon icon={Delete02Icon} />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
              {`<DropdownMenu>
  <DropdownMenuTrigger render={<Button>Actions</Button>} />
  <DropdownMenuContent>
    <DropdownMenuItem>Edit</DropdownMenuItem>
    <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>`}
            </pre>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Groups and Labels
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Organize items into sections with <InlineCode>DropdownMenuGroup</InlineCode> and{" "}
            <InlineCode>DropdownMenuLabel</InlineCode>.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex justify-center">
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline">Account</Button>} />
                <DropdownMenuContent className="w-48">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Account</DropdownMenuLabel>
                    <DropdownMenuItem>
                      <HugeiconsIcon icon={Settings01Icon} />
                      Settings
                      <DropdownMenuShortcut>⌘,</DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <HugeiconsIcon icon={Mail01Icon} />
                      Messages
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Team</DropdownMenuLabel>
                    <DropdownMenuItem>
                      <HugeiconsIcon icon={UserAdd01Icon} />
                      Invite Members
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive">
                    <HugeiconsIcon icon={Logout03Icon} />
                    Log Out
                    <DropdownMenuShortcut>⇧⌘Q</DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Checkbox Items
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Toggle items with <InlineCode>DropdownMenuCheckboxItem</InlineCode>.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex justify-center">
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline">View</Button>} />
                <DropdownMenuContent className="w-48">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Appearance</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem
                      checked={showStatusBar}
                      onCheckedChange={setShowStatusBar}
                    >
                      Status Bar
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem checked={showPanel} onCheckedChange={setShowPanel}>
                      Side Panel
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Radio Items
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Single-select with <InlineCode>DropdownMenuRadioGroup</InlineCode> and{" "}
            <InlineCode>DropdownMenuRadioItem</InlineCode>.
          </Text>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex justify-center">
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline">Sort: {sortBy}</Button>} />
                <DropdownMenuContent className="w-48">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Sort By</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuRadioGroup value={sortBy} onValueChange={setSortBy}>
                      <DropdownMenuRadioItem value="date">Date</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="size">Size</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Submenus
          </Heading>
          <div className="flex flex-col gap-6 border border-border bg-card p-8">
            <div className="flex justify-center">
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline">More</Button>} />
                <DropdownMenuContent className="w-48">
                  <DropdownMenuItem>
                    <HugeiconsIcon icon={Download04Icon} />
                    Download
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <HugeiconsIcon icon={Share01Icon} />
                      Share
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem>Copy Link</DropdownMenuItem>
                      <DropdownMenuItem>Email</DropdownMenuItem>
                      <DropdownMenuItem>Slack</DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled>Archive (disabled)</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Accessibility
          </Heading>
          <div className="max-w-xl space-y-2">
            <Text as="p" size="xs" variant="muted" density="comfortable">
              Built on Base UI's Menu with full ARIA menu semantics. Arrow Up/Down navigates items,
              Enter/Space activates, Escape closes, Right arrow opens submenus, Left arrow closes
              them.
            </Text>
          </div>
        </section>
      </>
    );
  },
};
