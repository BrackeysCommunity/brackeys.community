import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { GlitchTransition } from "@/components/ui/glitch-transition";
import { Heading, InlineCode, Text } from "@/components/ui/typography";

const meta: Meta<typeof GlitchTransition> = {
  title: "Components/GlitchTransition",
  component: GlitchTransition,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="flex min-w-[720px] flex-col items-start gap-10 bg-background p-12">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof GlitchTransition>;

function DemoCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex w-[320px] flex-col gap-2 border border-border bg-card p-6">
      <div className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
        // signal_0x4F
      </div>
      <div className="font-mono text-lg font-semibold text-foreground">{title}</div>
      <div className="text-xs text-muted-foreground">{body}</div>
      <div className="mt-2 h-1 w-full bg-primary" />
    </div>
  );
}

export const Overview: Story = {
  render: () => {
    const [manual, setManual] = useState(false);
    const [pageIndex, setPageIndex] = useState(0);
    const pages = [
      { title: "NODE_01 / INGEST", body: "Stream online. Throughput nominal." },
      { title: "NODE_02 / RELAY", body: "Signal reroute in progress." },
      { title: "NODE_03 / CORE", body: "Memory bank synchronized." },
    ];
    const page = pages[pageIndex];

    return (
      <>
        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Imports
          </Heading>
          <pre className="border border-border bg-card px-4 py-3 font-mono text-xs text-muted-foreground">
            <code>
              <span className="text-primary">import</span>
              {" { GlitchTransition } "}
              <span className="text-primary">from</span>
              {" '@/components/ui/glitch-transition';"}
            </code>
          </pre>
          <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
            A zero-styling wrapper that applies configurable sci-fi glitch transitions (jitter,
            skew, RGB split, slice cuts, flicker, optional scanlines) to any frame, card, or
            page-level content. Children keep their own layout and state.
          </Text>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Mount
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Plays once when the component mounts. Default trigger.
          </Text>
          <div className="border border-border bg-card p-8">
            <GlitchTransition duration={0.7} intensity={0.9}>
              <DemoCard
                title="MOUNT_GLITCH"
                body="This card glitched in on first render and then settled."
              />
            </GlitchTransition>
          </div>
          <pre className="border-t border-border pt-4 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
            {`<GlitchTransition duration={0.7} intensity={0.9}>
  <Card />
</GlitchTransition>`}
          </pre>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Manual Trigger
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Set <InlineCode>trigger=&quot;manual&quot;</InlineCode> and drive the glitch with{" "}
            <InlineCode>active</InlineCode>. Toggling <InlineCode>active</InlineCode> back to{" "}
            <InlineCode>true</InlineCode> replays it.
          </Text>
          <div className="flex flex-col gap-4 border border-border bg-card p-8">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="border border-border bg-primary px-3 py-1.5 font-mono text-xs text-primary-foreground"
                onClick={() => setManual((m) => !m)}
              >
                {manual ? "STOP" : "GLITCH"}
              </button>
              <span className="font-mono text-xs text-muted-foreground">
                active={String(manual)}
              </span>
            </div>
            <GlitchTransition trigger="manual" active={manual} duration={0.8} intensity={1}>
              <DemoCard
                title="MANUAL_GLITCH"
                body="Click GLITCH to play the animation on demand."
              />
            </GlitchTransition>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            On Change (Page / Content Swap)
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Use <InlineCode>trigger=&quot;change&quot;</InlineCode> with{" "}
            <InlineCode>triggerKey</InlineCode> to replay the glitch whenever the keyed value
            changes — ideal for page / route / card content transitions.
          </Text>
          <div className="flex flex-col gap-4 border border-border bg-card p-8">
            <div className="flex items-center gap-2">
              {pages.map((p, i) => (
                <button
                  key={p.title}
                  type="button"
                  className={`border border-border px-3 py-1.5 font-mono text-xs ${
                    i === pageIndex
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-foreground"
                  }`}
                  onClick={() => setPageIndex(i)}
                >
                  {p.title.split(" ")[0]}
                </button>
              ))}
            </div>
            <GlitchTransition
              trigger="change"
              triggerKey={pageIndex}
              duration={0.55}
              intensity={0.85}
              scanlines
            >
              <DemoCard title={page.title} body={page.body} />
            </GlitchTransition>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Hover
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Plays on pointer enter. Good for interactive tiles.
          </Text>
          <div className="border border-border bg-card p-8">
            <GlitchTransition trigger="hover" duration={0.4} intensity={0.7}>
              <DemoCard title="HOVER_ME" body="Pointer enter replays the glitch." />
            </GlitchTransition>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Continuous
          </Heading>
          <Text as="p" size="xs" variant="muted">
            An infinite subtle glitch loop for ambient sci-fi frames. Tune{" "}
            <InlineCode>intensity</InlineCode> down for background use.
          </Text>
          <div className="border border-border bg-card p-8">
            <GlitchTransition trigger="continuous" duration={2.4} intensity={0.25}>
              <DemoCard title="CONTINUOUS_FEED" body="Low-intensity perpetual glitch." />
            </GlitchTransition>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Intensity Scale
          </Heading>
          <Text as="p" size="xs" variant="muted">
            <InlineCode>intensity</InlineCode> (0–1) scales displacement, skew, and RGB split
            together. Override any individually via <InlineCode>displacement</InlineCode>,{" "}
            <InlineCode>skew</InlineCode>, <InlineCode>rgbSplit</InlineCode>.
          </Text>
          <div className="grid grid-cols-3 gap-6 border border-border bg-card p-8">
            {[0.3, 0.7, 1].map((i) => (
              <div key={i} className="flex flex-col gap-2">
                <div className="font-mono text-[10px] text-muted-foreground">intensity={i}</div>
                <GlitchTransition trigger="continuous" duration={1.8} intensity={i}>
                  <div className="flex h-24 w-full items-center justify-center border border-border bg-background font-mono text-xs text-foreground">
                    {`LVL_${i}`}
                  </div>
                </GlitchTransition>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Custom RGB Channels
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Override channel tints with <InlineCode>colorA</InlineCode> and{" "}
            <InlineCode>colorB</InlineCode>.
          </Text>
          <div className="grid grid-cols-2 gap-6 border border-border bg-card p-8">
            <GlitchTransition
              trigger="continuous"
              duration={1.6}
              intensity={0.8}
              colorA="#00ff88"
              colorB="#ff0066"
            >
              <DemoCard title="TOXIC" body="Green / magenta split." />
            </GlitchTransition>
            <GlitchTransition
              trigger="continuous"
              duration={1.6}
              intensity={0.8}
              colorA="#ffdd00"
              colorB="#0055ff"
              scanlines
            >
              <DemoCard title="BROADCAST" body="Amber / blue + scanlines." />
            </GlitchTransition>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Page-Level Frame
          </Heading>
          <Text as="p" size="xs" variant="muted">
            Wrap an entire page / layout. Children keep their own layout and focus.
          </Text>
          <GlitchTransition duration={0.9} intensity={1} scanlines>
            <div className="flex w-[640px] flex-col gap-4 border border-border bg-card p-10">
              <div className="font-mono text-xs text-muted-foreground">// ROUTE / dashboard</div>
              <div className="font-mono text-2xl font-bold text-foreground">CONTROL_DECK</div>
              <div className="grid grid-cols-3 gap-3">
                {["PWR", "NET", "MEM"].map((k) => (
                  <div
                    key={k}
                    className="border border-border bg-background p-3 font-mono text-[10px] text-foreground"
                  >
                    <div className="text-muted-foreground">{k}</div>
                    <div className="text-lg">{Math.floor(Math.random() * 100)}%</div>
                  </div>
                ))}
              </div>
            </div>
          </GlitchTransition>
        </section>

        <section className="flex flex-col gap-3">
          <Heading as="h2" size="sm" monospace>
            Props
          </Heading>
          <div className="max-w-2xl border border-border bg-card p-6 font-mono text-xs text-foreground">
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <span className="text-primary">trigger</span>
              <span className="text-muted-foreground">
                "mount" | "manual" | "change" | "hover" | "continuous"
              </span>
              <span className="text-primary">active</span>
              <span className="text-muted-foreground">boolean (with trigger="manual")</span>
              <span className="text-primary">triggerKey</span>
              <span className="text-muted-foreground">
                any (with trigger="change" — replays on change)
              </span>
              <span className="text-primary">duration</span>
              <span className="text-muted-foreground">seconds — default 0.6</span>
              <span className="text-primary">intensity</span>
              <span className="text-muted-foreground">0–1 — default 1</span>
              <span className="text-primary">displacement / skew / rgbSplit</span>
              <span className="text-muted-foreground">fine-grained overrides in px / deg</span>
              <span className="text-primary">colorA / colorB</span>
              <span className="text-muted-foreground">RGB split channel tints</span>
              <span className="text-primary">scanlines</span>
              <span className="text-muted-foreground">CRT overlay while active</span>
              <span className="text-primary">flicker</span>
              <span className="text-primary">onGlitchEnd</span>
              <span className="text-muted-foreground">fires when one-shot animation completes</span>
            </div>
          </div>
          <Text as="p" size="xs" variant="muted" density="comfortable" className="max-w-xl">
            Respects <InlineCode>prefers-reduced-motion</InlineCode> — animation and RGB layers are
            disabled for users who opted out.
          </Text>
        </section>
      </>
    );
  },
};
