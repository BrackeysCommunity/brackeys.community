import { LegalHammerIcon, PencilIcon, Robot01Icon } from "@hugeicons/core-free-icons";
import { useStore } from "@tanstack/react-store";
import type { Variants } from "framer-motion";
import { animate, motion, useMotionValue } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

import type { CommandEntryData } from "@/components/home/CommandEntry";
import { buildCopyText } from "@/components/home/CommandRow";
import { CommandTerminal } from "@/components/home/CommandTerminal";
import { HeroWordmark } from "@/components/home/HeroWordmark";
import { NodeCard } from "@/components/home/NodeCard";
import { SectionRule } from "@/components/home/SectionRule";
import { Hotkey } from "@/components/ui/hotkey";
import { hammerCommands, marcoMacros, pencilCommands } from "@/data/commands";
import type { BotId } from "@/data/commands";
import { activeUserStore } from "@/lib/active-user-store";
import { cn } from "@/lib/utils";

type ActiveBot = "all" | BotId;

// ── Unified entry list ───────────────────────────────────────────────
// Commands and macros both flow into the same terminal list. Commands keep
// their option-based copy text; macros use the `/macro name:…` form.

function buildEntries(username?: string): (CommandEntryData & { bot: BotId })[] {
  const commands: (CommandEntryData & { bot: BotId })[] = [
    ...hammerCommands,
    ...pencilCommands,
  ].map((c, i) => {
    // Mirror CommandRow's option-list logic: hide `mention` when no active
    // username is set, render as `name: description` + optional required tag,
    // and let buildCopyText own the default-value formatting in the example.
    const visibleOptions = c.options?.filter((o) => username || o.name !== "mention") ?? [];
    const body = visibleOptions.length
      ? visibleOptions
          .map((o) => `- \`${o.name}\`: ${o.description}${o.required ? " _(required)_" : ""}`)
          .join("\n")
      : undefined;

    return {
      id: c.id,
      index: i + 1,
      label: c.cmd,
      bot: c.bot,
      description: c.description,
      body,
      aliases: [],
      copyText: buildCopyText(c, username),
    };
  });

  // Marco macro descriptions use Discord-flavored conventions: `• ` bullets and
  // `<url>` autolinks. Convert bullets to markdown list syntax and ensure a
  // blank line precedes the list so marked parses it as a real <ul>.
  const normalizeMarkdown = (src: string) =>
    src.replace(/^• /gm, "- ").replace(/([^\n])\n(- )/g, "$1\n\n$2");

  const macros: (CommandEntryData & { bot: BotId })[] = marcoMacros.map((m, i) => ({
    id: `macro:${m.name}`,
    index: commands.length + i + 1,
    label: `[]${m.name}`,
    bot: "marco" as const,
    description: m.description.split("\n")[0].slice(0, 200),
    body: normalizeMarkdown(m.description),
    aliases: m.aliases,
    copyText: `/macro name:${m.name}`,
    altCopyText: `[]${m.name}`,
  }));

  return [...commands, ...macros];
}

// ── Bot-card graphics ────────────────────────────────────────────────
// Each bot gets a unique vignette that speaks to its *role*, rather than
// re-using the home-page command-list / tag-row / sparkline widgets.

// Gavel striking a sound block. The hammer is rotated via SVG's native
// `rotate(angle cx cy)` transform syntax so the pivot is exactly at the
// grip end of the handle — CSS transform-origin on SVG groups is too
// easy to get wrong across browsers.
//
// Geometry (viewBox 0 0 100 60):
//   pivot at (PIVOT_X, PIVOT_Y)         — grip end of the handle
//   head center at rest: (40, 34)       — opposite end from the pivot
//   anvil top y = 46
const PIVOT_X = 72;
const PIVOT_Y = 34;
const SWING_KEYFRAMES = [8, 8, 42, 42, -8, 2, 8];
const SWING_TIMES = [0, 0.2, 0.4, 0.55, 0.62, 0.72, 1];

function HammerGraphic({ active }: { active: boolean }) {
  const groupRef = useRef<SVGGElement>(null);
  const rotation = useMotionValue(SWING_KEYFRAMES[0]);

  useEffect(() => {
    if (!active) {
      const settle = animate(rotation, SWING_KEYFRAMES[0], { duration: 0.25 });
      return () => settle.stop();
    }
    const controls = animate(rotation, SWING_KEYFRAMES, {
      duration: 1.4,
      repeat: Number.POSITIVE_INFINITY,
      times: SWING_TIMES,
      ease: "easeInOut",
    });
    return () => controls.stop();
  }, [active, rotation]);

  useEffect(() => {
    const unsubscribe = rotation.on("change", (r) => {
      groupRef.current?.setAttribute("transform", `rotate(${r} ${PIVOT_X} ${PIVOT_Y})`);
    });
    return unsubscribe;
  }, [rotation]);

  return (
    <div className="flex h-full w-full flex-col justify-center gap-2">
      <span className="font-mono text-[9px] tracking-widest text-muted-foreground/70 uppercase">
        // moderation
      </span>

      <svg
        viewBox="0 0 100 60"
        className="h-16 w-full text-accent"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {/* Sound block / anvil */}
        <rect
          x="20"
          y="46"
          width="60"
          height="9"
          rx="1"
          strokeWidth="1.5"
          fill="currentColor"
          fillOpacity="0.18"
        />
        <line x1="22" y1="48.5" x2="78" y2="48.5" strokeWidth="0.75" opacity="0.45" />

        {/* Impact sparks — fire at the moment of contact, centered under the head */}
        <motion.g
          stroke="currentColor"
          strokeWidth="1.25"
          initial={{ opacity: 0 }}
          animate={active ? { opacity: [0, 0, 0, 1, 0] } : { opacity: 0 }}
          transition={
            active
              ? {
                  duration: 1.4,
                  repeat: Number.POSITIVE_INFINITY,
                  times: [0, 0.58, 0.6, 0.64, 0.82],
                }
              : { duration: 0 }
          }
        >
          <line x1="42" y1="44" x2="30" y2="36" />
          <line x1="42" y1="44" x2="54" y2="36" />
          <line x1="42" y1="44" x2="26" y2="46" />
          <line x1="42" y1="44" x2="58" y2="46" />
          <line x1="42" y1="44" x2="36" y2="30" />
          <line x1="42" y1="44" x2="48" y2="30" />
        </motion.g>

        {/* Hammer — rotates around (PIVOT_X, PIVOT_Y) via the SVG `transform`
            attribute, which supports rotate(angle cx cy) natively. We drive
            it through a MotionValue + ref so the pivot is exact. */}
        <g ref={groupRef} transform={`rotate(${SWING_KEYFRAMES[0]} ${PIVOT_X} ${PIVOT_Y})`}>
          <line x1="50" y1="34" x2="70" y2="34" strokeWidth="3" />
          <rect
            x="32"
            y="26"
            width="16"
            height="16"
            rx="1.5"
            strokeWidth="2"
            fill="currentColor"
            fillOpacity="0.2"
          />
          <line x1="34" y1="34" x2="46" y2="34" strokeWidth="1" opacity="0.5" />
        </g>
      </svg>
    </div>
  );
}

const TEX_TOKENS: { s: string; cls: string }[] = [
  { s: "e", cls: "text-foreground" },
  { s: "^{i\\pi}", cls: "text-accent" },
  { s: " + 1", cls: "text-foreground" },
  { s: " = ", cls: "text-muted-foreground" },
  { s: "0", cls: "text-accent" },
];

function RenderedFormula() {
  // Rendered form of: e^{i\pi} + 1 = 0  (Euler's identity)
  return (
    <span className="flex items-baseline gap-1 font-serif text-[16px] leading-none italic">
      <span className="text-foreground">
        e<sup className="ml-px text-[10px] text-accent">iπ</sup>
      </span>
      <span className="text-foreground not-italic">+ 1</span>
      <span className="text-muted-foreground not-italic">=</span>
      <span className="text-accent not-italic">0</span>
    </span>
  );
}

function PencilGraphic({ active }: { active: boolean }) {
  // Reveal tokens one-by-one → brief pause → swap to rendered form → rest → loop.
  const revealEnd = TEX_TOKENS.length; // step at which all tokens are visible
  const renderStep = revealEnd + 1; // rendered formula replaces raw TeX
  const steps = renderStep + 2; // one extra beat before looping

  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!active) {
      setStep(0);
      return;
    }
    const id = window.setInterval(() => {
      setStep((s) => {
        const next = s + 1;
        return next >= steps ? 0 : next;
      });
    }, 650);
    return () => window.clearInterval(id);
  }, [active, steps]);

  const showRendered = step >= renderStep;

  return (
    <div className="flex h-full w-full flex-col justify-center gap-2">
      <span className="font-mono text-[9px] tracking-widest text-muted-foreground/70 uppercase">
        // tex render
      </span>
      <div className="relative h-8">
        <motion.div
          initial={false}
          animate={{ opacity: showRendered ? 0 : 1 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 flex flex-wrap items-baseline gap-x-1 font-mono text-[13px] leading-none tracking-tight"
        >
          {TEX_TOKENS.map((t, i) => (
            <motion.span
              key={t.s}
              initial={false}
              animate={{ opacity: step > i ? 1 : 0.12, y: step > i ? 0 : 3 }}
              transition={{ duration: 0.2 }}
              className={t.cls}
            >
              {t.s}
            </motion.span>
          ))}
          <motion.span
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 0.9, repeat: Number.POSITIVE_INFINITY }}
            className="ml-0.5 inline-block h-3 w-[6px] bg-accent align-middle"
          />
        </motion.div>
        <motion.div
          initial={false}
          animate={{ opacity: showRendered ? 1 : 0 }}
          transition={{ duration: 0.25 }}
          className="absolute inset-0 flex items-center"
        >
          <RenderedFormula />
        </motion.div>
      </div>
    </div>
  );
}

function MarcoGraphic({ active }: { active: boolean }) {
  const previewMacros = useMemo(() => marcoMacros.slice(0, 14), []);
  const [cursor, setCursor] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setCursor((i) => (i + 1) % previewMacros.length), 320);
    return () => window.clearInterval(id);
  }, [active, previewMacros.length]);

  const windowSize = 4;
  const visible = Array.from({ length: windowSize }, (_, i) => {
    const macro = previewMacros[(cursor + i) % previewMacros.length];
    return macro;
  });

  return (
    <div className="flex h-full w-full min-w-0 flex-col gap-1 overflow-hidden font-mono text-xs">
      <span className="font-mono text-[9px] tracking-widest text-muted-foreground/70 uppercase">
        // macro queue
      </span>
      <ul className="flex flex-col gap-0.5">
        {visible.map((m, i) => (
          <motion.li
            key={`${m.name}-${(cursor + i) % previewMacros.length}`}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1 - i * 0.22, x: 0 }}
            transition={{ duration: 0.22 }}
            className="flex min-w-0 items-center gap-2"
          >
            <span className="shrink-0 text-accent">{i === 0 ? ">" : " "}</span>
            <span className={cn("shrink-0", i === 0 ? "text-accent" : "text-muted-foreground/80")}>
              /macro
            </span>
            <span
              className={cn(
                "min-w-0 truncate",
                i === 0 ? "text-foreground" : "text-muted-foreground/60",
              )}
            >
              {m.name}
            </span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

// ── Animation variants ───────────────────────────────────────────────

const container: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.25 },
  },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
  },
};

const fadeLeft: Variants = {
  hidden: { opacity: 0, x: 24 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
  },
};

const cardRow: Variants = {
  hidden: { opacity: 1 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1, delayChildren: 0.05 } },
};

// ── Page ─────────────────────────────────────────────────────────────

export function CommandCenterPage() {
  const [search, setSearch] = useState("");
  const [activeBot, setActiveBot] = useState<ActiveBot>("all");
  const user = useStore(activeUserStore);
  const username = user.profile?.discordUsername ?? undefined;

  const allEntries = useMemo(() => buildEntries(username), [username]);

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = allEntries.filter((e) => {
      if (activeBot !== "all" && e.bot !== activeBot) return false;
      if (q) {
        const haystack = [e.label, e.description, e.body ?? "", ...(e.aliases ?? [])]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    return filtered.map((e, i) => ({ ...e, index: i + 1 }));
  }, [allEntries, activeBot, search]);

  const botCounts = useMemo(
    () => ({
      hammer: allEntries.filter((e) => e.bot === "hammer").length,
      pencil: allEntries.filter((e) => e.bot === "pencil").length,
      marco: allEntries.filter((e) => e.bot === "marco").length,
    }),
    [allEntries],
  );

  return (
    <motion.div
      className="flex flex-col gap-8 pb-10 lg:gap-10"
      variants={container}
      initial="hidden"
      animate="visible"
    >
      <div className="grid grid-cols-1 items-start gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] xl:gap-10">
        {/* LEFT: status + hero + bot cards */}
        <div className="flex flex-col gap-8">
          <div className="flex flex-col">
            <motion.div variants={fadeUp} className="mt-8 lg:mt-12">
              <HeroWordmark primary="BOT" secondary="DOCS" />
            </motion.div>
            <motion.p
              variants={fadeUp}
              className="mt-6 max-w-xl font-sans text-base text-foreground [text-shadow:0_1px_3px_rgba(0,0,0,0.75)] lg:text-lg"
            >
              Full command reference for every bot in the Brackeys server. Filter by bot, jump with{" "}
              <Hotkey value="command+k" />, or browse freely.
            </motion.p>
          </div>

          <motion.div variants={fadeUp}>
            <SectionRule label="Select Bot" />
          </motion.div>

          {/* Bot cards */}
          <motion.div
            className="grid grid-cols-1 gap-1 md:grid-cols-3 md:[&>*]:min-w-0"
            variants={cardRow}
          >
            <motion.div variants={fadeUp} className="min-w-0">
              <NodeCard
                index="01"
                title={"HAMMER\nBOT"}
                icon={LegalHammerIcon}
                stat={String(botCounts.hammer)}
                statLabel="Moderation"
                active={activeBot === "hammer"}
                onClick={() => setActiveBot((prev) => (prev === "hammer" ? "all" : "hammer"))}
                middle={(revealed) => <HammerGraphic active={revealed} />}
              />
            </motion.div>
            <motion.div variants={fadeUp} className="min-w-0">
              <NodeCard
                index="02"
                title={"PENCIL\nBOT"}
                icon={PencilIcon}
                stat={String(botCounts.pencil)}
                statLabel="Utilities"
                active={activeBot === "pencil"}
                onClick={() => setActiveBot((prev) => (prev === "pencil" ? "all" : "pencil"))}
                middle={(revealed) => <PencilGraphic active={revealed} />}
              />
            </motion.div>
            <motion.div variants={fadeUp} className="min-w-0">
              <NodeCard
                index="03"
                title={"MARCO\nBOT"}
                icon={Robot01Icon}
                stat={String(botCounts.marco)}
                statLabel="Macros"
                active={activeBot === "marco"}
                onClick={() => setActiveBot((prev) => (prev === "marco" ? "all" : "marco"))}
                middle={(revealed) => <MarcoGraphic active={revealed} />}
              />
            </motion.div>
          </motion.div>
        </div>

        {/* RIGHT: command terminal */}
        <motion.div variants={fadeLeft} className="flex flex-1 [&>*]:flex-1">
          <CommandTerminal
            entries={filteredEntries}
            totalCount={allEntries.length}
            search={search}
            onSearchChange={setSearch}
          />
        </motion.div>
      </div>
    </motion.div>
  );
}
