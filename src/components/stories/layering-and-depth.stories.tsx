import type { Meta, StoryObj } from "@storybook/react";

import { Button } from "@/components/ui/button";
import { Heading, InlineCode, Text } from "@/components/ui/typography";

const meta: Meta = {
  title: "Foundations/Layering & Depth",
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

const Z_LAYERS: Array<{ z: string; usage: string; examples: string }> = [
  { z: "auto / 0", usage: "Base content flow", examples: "page content, inline elements" },
  { z: "1–10", usage: "In-flow stacking", examples: "focus rings, hovered cells, sticky headers" },
  {
    z: "20",
    usage: "Button group seams & overlapping controls",
    examples: "ButtonGroupSeparator",
  },
  {
    z: "40",
    usage: "Persistent overlays (no scrim)",
    examples: "SlideOverPanel, detail panels",
  },
  {
    z: "50",
    usage: "Modal / transient surfaces",
    examples: "Dialog, Sheet, Drawer, Popover, Tooltip, ContextMenu, HoverCard",
  },
  { z: "9999", usage: "Global pointer affordances", examples: "Cursor overlay" },
];

const EMBOSS_ROWS: Array<{ name: string; role: string; lift: string }> = [
  {
    name: "chonk-emboss",
    role: "Primary interactive lift — buttons, toggles",
    lift: "2px idle, 3px hover, 0px active",
  },
  {
    name: "chonk-emboss-panel",
    role: "Larger card/panel lift",
    lift: "2px idle, 3px hover, 0px active",
  },
  {
    name: "chonk-emboss-notched",
    role: "Notched variant emboss for chamfered buttons",
    lift: "2px idle, 3px hover, 0px active",
  },
  {
    name: "chonk-deboss",
    role: "Recessed inputs — text fields, textareas",
    lift: "inset 2px; deepens on focus",
  },
  {
    name: "switch-thumb-emboss",
    role: "Switch thumb driven by parent hover/active",
    lift: "1px idle, 2px hover, 0px active",
  },
];

export const Overview: Story = {
  render: () => (
    <>
      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Philosophy
        </Heading>
        <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
          Depth in Brackeys is expressed through <strong>emboss</strong> and <strong>deboss</strong>{" "}
          — solid offset shadows rather than soft blurs — and a small, predictable set of{" "}
          <strong>z-index layers</strong>. Every interactive element is either pushed up off the
          page, pressed into it, or sitting flat. There is no middle ground.
        </Text>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Z-index Scale
        </Heading>
        <Text as="p" size="xs" variant="muted" className="max-w-xl">
          Use a small, named set of values. If something new needs to stack above an existing layer,
          consider whether it belongs at an existing tier first.
        </Text>
        <div className="overflow-hidden border border-border bg-card">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2">
                  <Text size="xs" variant="muted" monospace>
                    Layer
                  </Text>
                </th>
                <th className="px-4 py-2">
                  <Text size="xs" variant="muted" monospace>
                    Usage
                  </Text>
                </th>
                <th className="px-4 py-2">
                  <Text size="xs" variant="muted" monospace>
                    Examples
                  </Text>
                </th>
              </tr>
            </thead>
            <tbody>
              {Z_LAYERS.map((row) => (
                <tr key={row.z} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-2">
                    <InlineCode>z-{row.z}</InlineCode>
                  </td>
                  <td className="px-4 py-2">
                    <Text size="xs">{row.usage}</Text>
                  </td>
                  <td className="px-4 py-2">
                    <Text size="xs" variant="muted">
                      {row.examples}
                    </Text>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Stacking in Practice
        </Heading>
        <Text as="p" size="xs" variant="muted" className="max-w-xl">
          Visual mockup of the layering order. Each tier is meaningfully distinct — no reliance on
          soft blur to imply separation.
        </Text>
        <div className="relative flex h-60 w-full items-end justify-center overflow-hidden border border-border bg-card">
          <div className="absolute inset-x-6 top-24 bottom-6 border border-border bg-background">
            <div className="p-3">
              <Text size="xs" variant="muted" monospace>
                z-0 · page content
              </Text>
            </div>
          </div>
          <div className="absolute top-20 left-14 h-28 w-56 border border-border bg-muted shadow-[2px_2px_0_0_var(--emboss-shadow)]">
            <div className="p-3">
              <Text size="xs" monospace>
                z-40 · SlideOverPanel
              </Text>
            </div>
          </div>
          <div className="absolute top-10 right-14 h-24 w-52 border border-border bg-foreground text-background shadow-[2px_2px_0_0_color-mix(in_srgb,var(--foreground)_50%,black)]">
            <div className="p-3">
              <Text size="xs" monospace className="text-background">
                z-50 · Dialog / Popover
              </Text>
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Emboss & Deboss
        </Heading>
        <Text as="p" size="xs" variant="muted" className="max-w-xl">
          Depth is expressed with solid, offset shadows — no soft blurs. Interactive elements sit
          above the page (emboss) or below it (deboss). On hover they lift further; on active they
          press flat.
        </Text>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-3 border border-border bg-card p-6">
            <Text size="xs" variant="muted" monospace>
              Emboss
            </Text>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="default">Default</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
            </div>
            <Text size="xs" variant="muted" density="comfortable">
              Raises the element off the surface with a drop of{" "}
              <InlineCode>--emboss-shadow</InlineCode>. Active state pushes it flat.
            </Text>
          </div>
          <div className="flex flex-col gap-3 border border-border bg-card p-6">
            <Text size="xs" variant="muted" monospace>
              Deboss
            </Text>
            <div className="flex flex-wrap items-center gap-3">
              <input
                className="chonk-deboss h-8 w-full border bg-background px-2 text-xs outline-none"
                placeholder="Text input"
              />
            </div>
            <Text size="xs" variant="muted" density="comfortable">
              Sinks the element into the surface with an inset of{" "}
              <InlineCode>--deboss-shadow</InlineCode>. Focus deepens the shadow to{" "}
              <InlineCode>--ring</InlineCode>.
            </Text>
          </div>
        </div>

        <div className="mt-3 border border-border bg-card">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2">
                  <Text size="xs" variant="muted" monospace>
                    Utility
                  </Text>
                </th>
                <th className="px-4 py-2">
                  <Text size="xs" variant="muted" monospace>
                    Role
                  </Text>
                </th>
                <th className="px-4 py-2">
                  <Text size="xs" variant="muted" monospace>
                    Lift
                  </Text>
                </th>
              </tr>
            </thead>
            <tbody>
              {EMBOSS_ROWS.map((row) => (
                <tr key={row.name} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-2 align-top">
                    <InlineCode>{row.name}</InlineCode>
                  </td>
                  <td className="px-4 py-2 align-top">
                    <Text size="xs">{row.role}</Text>
                  </td>
                  <td className="px-4 py-2 align-top">
                    <Text size="xs" variant="muted">
                      {row.lift}
                    </Text>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Tokens
        </Heading>
        <Text as="p" size="xs" variant="muted" className="max-w-xl">
          Depth is themeable through CSS custom properties. Prefer utilities; reach for raw tokens
          only when building new primitives.
        </Text>
        <div className="border border-border bg-card">
          <table className="w-full text-left text-xs">
            <tbody>
              {[
                { token: "--emboss-shadow", desc: "Offset shadow color for raised elements" },
                { token: "--deboss-shadow", desc: "Inset shadow color for recessed elements" },
                { token: "--emboss-surface", desc: "Neutral surface color for embossed panels" },
                {
                  token: "--chonk-lift",
                  desc: "Idle lift distance (set on each variant, typically 1–2px)",
                },
                { token: "--chonk-lift-hover", desc: "Hover lift distance (typically 2–3px)" },
                { token: "--chonk-y", desc: "Current lift — animates between the two states" },
                { token: "--ring", desc: "Focus ring color; also deepens deboss on focus" },
              ].map((row) => (
                <tr key={row.token} className="border-b border-border last:border-b-0">
                  <td className="px-4 py-2 align-top">
                    <InlineCode>{row.token}</InlineCode>
                  </td>
                  <td className="px-4 py-2">
                    <Text size="xs">{row.desc}</Text>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Heading as="h2" size="sm" monospace>
          Guidelines
        </Heading>
        <div className="max-w-xl space-y-2">
          <Text as="p" size="xs" variant="muted" density="comfortable">
            <strong>Do</strong> express depth with emboss/deboss — solid offset shadows that read
            even on hi-contrast themes.
          </Text>
          <Text as="p" size="xs" variant="muted" density="comfortable">
            <strong>Do</strong> keep backdrop scrims subtle (<InlineCode>bg-black/10</InlineCode>{" "}
            with a light backdrop blur); the app should stay readable behind a modal.
          </Text>
          <Text as="p" size="xs" variant="muted" density="comfortable">
            <strong>Do</strong> use <InlineCode>isolate</InlineCode> on popup/portal roots so nested{" "}
            <InlineCode>z-index</InlineCode> values don&apos;t leak across layers.
          </Text>
          <Text as="p" size="xs" variant="muted" density="comfortable">
            <strong>Don&apos;t</strong> invent new z-index values. If none of the tiers fit, the
            design probably needs to be rethought.
          </Text>
          <Text as="p" size="xs" variant="muted" density="comfortable">
            <strong>Don&apos;t</strong> use soft Gaussian box-shadows to imply elevation. Our depth
            language is deliberately graphic.
          </Text>
          <Text as="p" size="xs" variant="muted" density="comfortable">
            <strong>Don&apos;t</strong> stack embossed surfaces on embossed surfaces. Pick a
            dominant surface and keep children flat.
          </Text>
        </div>
      </section>
    </>
  ),
};
