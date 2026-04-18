import type { Meta, StoryObj } from "@storybook/react";

import { Hotkey } from "@/components/ui/hotkey";
import { Kbd } from "@/components/ui/kbd";
import { Heading, InlineCode, Text } from "@/components/ui/typography";

const meta: Meta<typeof Hotkey> = {
  title: "Components/Hotkey",
  component: Hotkey,
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
type Story = StoryObj<typeof Hotkey>;

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
            {" { Hotkey } "}
            <span className="text-primary">from</span>
            {" '@/components/ui/hotkey';"}
          </code>
        </pre>
        <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
          The <InlineCode>Hotkey</InlineCode> component displays keyboard shortcuts using semantic{" "}
          <InlineCode>&lt;kbd&gt;</InlineCode> elements with automatic platform-aware modifier
          rendering. On Mac, <InlineCode>command</InlineCode> renders as ⌘; on other platforms it
          renders as <InlineCode>CTRL</InlineCode>. Use <InlineCode>Kbd</InlineCode> for standalone
          key references in prose.
        </Text>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Hotkey
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Pass a string like <InlineCode>command+s</InlineCode>. The component splits on{" "}
          <InlineCode>+</InlineCode> and renders each piece as a key cap.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Text size="xs" variant="muted" className="w-16">
                Save:
              </Text>
              <Hotkey value="command+s" />
            </div>
            <div className="flex items-center gap-3">
              <Text size="xs" variant="muted" className="w-16">
                Search:
              </Text>
              <Hotkey value="command+k" />
            </div>
            <div className="flex items-center gap-3">
              <Text size="xs" variant="muted" className="w-16">
                Copy:
              </Text>
              <Hotkey value="command+c" />
            </div>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Hotkey value="command+s" />
<Hotkey value="command+k" />
<Hotkey value="command+c" />`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Platform Mapping
        </Heading>
        <Text as="p" size="xs" variant="muted" className="max-w-xl">
          Modifiers are automatically mapped per platform. No fallback arrays needed for standard
          modifier differences.
        </Text>
        <div className="border border-border bg-card p-8">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="pr-6 pb-2">
                  <Text size="xs" variant="muted" monospace>
                    Key name
                  </Text>
                </th>
                <th className="pr-6 pb-2">
                  <Text size="xs" variant="muted" monospace>
                    Mac
                  </Text>
                </th>
                <th className="pb-2">
                  <Text size="xs" variant="muted" monospace>
                    Other platforms
                  </Text>
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: "command", mac: "⌘", other: "CTRL" },
                { name: "ctrl", mac: "⌃", other: "CTRL" },
                { name: "alt", mac: "⌥", other: "ALT" },
                { name: "option", mac: "⌥", other: "ALT" },
                { name: "shift", mac: "⇧", other: "⇧" },
              ].map((row) => (
                <tr key={row.name} className="border-b border-border last:border-b-0">
                  <td className="py-2 pr-6">
                    <InlineCode>{row.name}</InlineCode>
                  </td>
                  <td className="py-2 pr-6">
                    <Kbd>{row.mac}</Kbd>
                  </td>
                  <td className="py-2">
                    <Kbd>{row.other}</Kbd>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Complex Shortcuts
        </Heading>
        <Text as="p" size="xs" variant="muted">
          Combine modifiers and keys by joining with <InlineCode>+</InlineCode>.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Text size="xs" variant="muted" className="w-20">
                Undo:
              </Text>
              <Hotkey value="command+z" />
            </div>
            <div className="flex items-center gap-3">
              <Text size="xs" variant="muted" className="w-20">
                Redo:
              </Text>
              <Hotkey value="command+shift+z" />
            </div>
            <div className="flex items-center gap-3">
              <Text size="xs" variant="muted" className="w-20">
                Navigate:
              </Text>
              <Hotkey value="shift+up" />
            </div>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Hotkey value="command+z" />
<Hotkey value="command+shift+z" />
<Hotkey value="shift+up" />`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Array Form
        </Heading>
        <Text as="p" size="xs" variant="muted" className="max-w-xl">
          Pass an array when the actual keys (not just modifiers) differ across platforms. The first
          combo is used.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <Hotkey value={["command+backspace", "delete"]} />
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Hotkey value={['command+backspace', 'delete']} />`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Kbd
        </Heading>
        <Text as="p" size="xs" variant="muted" className="max-w-xl">
          <InlineCode>Kbd</InlineCode> renders a single styled key cap. Use it for standalone key
          references in prose or documentation.
        </Text>
        <div className="flex flex-col gap-6 border border-border bg-card p-8">
          <div className="flex flex-col gap-2">
            <Text size="xs">
              Press <Kbd>Esc</Kbd> to close
            </Text>
            <Text size="xs">
              Use <Kbd>Tab</Kbd> to navigate
            </Text>
            <Text size="xs">
              Hit <Kbd>↵</Kbd> to confirm
            </Text>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<Text>Press <Kbd>Esc</Kbd> to close</Text>
<Text>Use <Kbd>Tab</Kbd> to navigate</Text>`}
          </pre>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Accessibility
        </Heading>
        <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
          Both <InlineCode>Hotkey</InlineCode> and <InlineCode>Kbd</InlineCode> render semantic{" "}
          <InlineCode>&lt;kbd&gt;</InlineCode> HTML elements. <InlineCode>Hotkey</InlineCode> wraps
          an outer <InlineCode>&lt;kbd&gt;</InlineCode> around inner ones for each key — the correct
          HTML semantics for a key combination.
        </Text>
      </section>
    </>
  ),
};
