import { LegalHammerIcon, PencilIcon, Robot01Icon } from "@hugeicons/core-free-icons";
import type { Variants } from "framer-motion";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";

import { StatusStrip, type StatusSegment } from "@/components/common/StatusStrip";
import type { CommandEntryData } from "@/components/home/CommandEntry";
import { CommandLegend } from "@/components/home/CommandLegend";
import {
  COMMAND_CATEGORIES,
  type CommandCategory,
  CommandTerminal,
} from "@/components/home/CommandTerminal";
import { CyclingWord } from "@/components/home/CyclingWord";
import { HeroWordmark } from "@/components/home/HeroWordmark";
import {
  NodeCard,
  NodeCardCommandList,
  NodeCardSparkline,
  NodeCardTagRow,
} from "@/components/home/NodeCard";
import { SectionRule } from "@/components/home/SectionRule";
import { GlitchTransition } from "@/components/ui/glitch-transition";
import { hammerCommands, marcoMacros, pencilCommands } from "@/data/commands";
import type { BotId } from "@/data/commands";

type ActiveBot = "all" | BotId;

// ── Entry classification ─────────────────────────────────────────────
// Mapping of specific command/macro ids to their dominant category, plus a
// fallback derived from the bot. Kept inline (rather than on the shared data
// module) so this is purely a presentation-layer concern.

const CATEGORY_BY_ID: Record<string, CommandCategory> = {
  // Utility-flavored pencil output
  "pencil-color": "utility",
  "pencil-tex": "utility",
  // Utility macros
  "macro:source": "utility",
  "macro:screenshot": "utility",
  "macro:codeblock": "utility",
  "macro:tryit": "utility",
  // Learning macros
  "macro:learnc#": "learning",
  "macro:learngit": "learning",
  "macro:xyproblem": "learning",
  "macro:basics": "learning",
  "macro:unclearquestion": "learning",
  "macro:nocode": "learning",
  "macro:nullreference": "learning",
  "macro:poorquestion": "learning",
  "macro:nointellisense": "learning",
  "macro:imageofcode": "learning",
  "macro:imageofanexception": "learning",
  "macro:nofind": "learning",
  "macro:passby": "learning",
  "macro:productive": "learning",
  // Fun macros
  "macro:tape": "fun",
  "macro:demod": "fun",
  "macro:🥄": "fun",
  "macro:ddg": "fun",
  "macro:google": "fun",
  // Gamification / server hygiene
  "macro:jbstudent": "gamification",
  "macro:projectideas": "gamification",
  "macro:pleasewait": "gamification",
  "macro:askhere": "gamification",
};

const POPULAR_IDS = new Set([
  "hammer-rule",
  "hammer-userinfo",
  "pencil-color",
  "pencil-tex",
  "macro:screenshot",
]);

function categoryFor(id: string, bot: BotId): CommandCategory {
  const override = CATEGORY_BY_ID[id];
  if (override) return override;
  if (bot === "hammer") return "moderation";
  if (bot === "pencil") return "utility";
  return "fun";
}

// ── Unified entry list ───────────────────────────────────────────────
// Commands and macros both flow into the same terminal list. Commands keep
// their option-based copy text; macros use the `/macro name:…` form.

function buildEntries(): (CommandEntryData & {
  bot: BotId;
  category: CommandCategory;
})[] {
  const commands: (CommandEntryData & { bot: BotId; category: CommandCategory })[] = [
    ...hammerCommands,
    ...pencilCommands,
  ].map((c, i) => ({
    id: c.id,
    index: i + 1,
    label: c.cmd,
    bot: c.bot,
    description: c.description,
    body: c.options
      ?.map(
        (o) =>
          `- **${o.name}**${o.required ? " (required)" : ""}: ${o.description}${
            o.default ? ` — default \`${o.default}\`` : ""
          }`,
      )
      .join("\n"),
    aliases: [],
    popular: POPULAR_IDS.has(c.id),
    copyText: c.cmd,
    category: categoryFor(c.id, c.bot),
  }));

  const macros: (CommandEntryData & { bot: BotId; category: CommandCategory })[] = marcoMacros.map(
    (m, i) => ({
      id: `macro:${m.name}`,
      index: commands.length + i + 1,
      label: `/${m.name}`,
      bot: "marco" as const,
      description: m.description
        .split("\n")[0]
        .replace(/__|\*\*/g, "")
        .slice(0, 140),
      body: m.description,
      aliases: m.aliases,
      popular: POPULAR_IDS.has(`macro:${m.name}`),
      copyText: `/macro name:${m.name}`,
      category: categoryFor(`macro:${m.name}`, "marco"),
    }),
  );

  return [...commands, ...macros];
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
  const [category, setCategory] = useState<CommandCategory>("all");

  const allEntries = useMemo(() => buildEntries(), []);

  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = allEntries.filter((e) => {
      if (activeBot !== "all" && e.bot !== activeBot) return false;
      if (category !== "all" && e.category !== category) return false;
      if (q) {
        const haystack = [e.label, e.description, e.body ?? "", ...(e.aliases ?? [])]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    // Re-index for display order
    return filtered.map((e, i) => ({ ...e, index: i + 1 }));
  }, [allEntries, activeBot, category, search]);

  const botCounts = useMemo(
    () => ({
      hammer: allEntries.filter((e) => e.bot === "hammer").length,
      pencil: allEntries.filter((e) => e.bot === "pencil").length,
      marco: allEntries.filter((e) => e.bot === "marco").length,
    }),
    [allEntries],
  );

  const statusSegments: StatusSegment[] = [
    { key: "status", value: "BOT DOCS ONLINE", leadingDot: true },
    { key: "version", value: `v${__APP_VERSION__}` },
    { key: "count", value: `${allEntries.length} COMMANDS INDEXED` },
  ];

  const scopeLabel =
    activeBot === "all" ? "All Bots" : activeBot.charAt(0).toUpperCase() + activeBot.slice(1);

  return (
    <GlitchTransition
      trigger="mount"
      duration={0.7}
      intensity={0.7}
      flicker
      style={{ width: "100%" }}
    >
      <motion.div
        className="flex flex-col gap-8 lg:gap-10"
        variants={container}
        initial="hidden"
        animate="visible"
      >
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] xl:gap-10">
          {/* LEFT: status + hero + bot cards + legend */}
          <div className="flex flex-col gap-8">
            <div className="flex flex-col">
              <motion.div variants={fadeUp}>
                <StatusStrip segments={statusSegments} />
              </motion.div>
              <motion.div variants={fadeUp} className="mt-20 lg:mt-28">
                <HeroWordmark primary={<CyclingWord />} secondary="DOCS" />
              </motion.div>
              <motion.p
                variants={fadeUp}
                className="mt-6 max-w-xl font-sans text-base text-foreground [text-shadow:0_1px_3px_rgba(0,0,0,0.75)] lg:text-lg"
              >
                Full command reference for every bot in the Brackeys server. Filter by bot, jump
                with{" "}
                <kbd className="rounded-xs border border-muted/60 bg-muted/40 px-1 font-mono text-xs">
                  ⌘K
                </kbd>
                , or browse by category.
              </motion.p>
            </div>

            <motion.div variants={fadeUp}>
              <SectionRule label="Select Bot" />
            </motion.div>

            {/* Bot cards */}
            <motion.div className="grid grid-cols-1 gap-4 md:grid-cols-3" variants={cardRow}>
              <motion.div variants={fadeUp}>
                <NodeCard
                  index="01"
                  title={"HAMMER\nBOT"}
                  icon={LegalHammerIcon}
                  stat={String(botCounts.hammer)}
                  statLabel="Moderation"
                  active={activeBot === "hammer"}
                  onClick={() => setActiveBot((prev) => (prev === "hammer" ? "all" : "hammer"))}
                  middle={
                    <NodeCardCommandList
                      commands={hammerCommands.slice(0, 4).map((c) => c.cmd.replace(/^\//, ""))}
                    />
                  }
                />
              </motion.div>
              <motion.div variants={fadeUp}>
                <NodeCard
                  index="02"
                  title={"PENCIL\nBOT"}
                  icon={PencilIcon}
                  stat={String(botCounts.pencil)}
                  statLabel="Utilities"
                  active={activeBot === "pencil"}
                  onClick={() => setActiveBot((prev) => (prev === "pencil" ? "all" : "pencil"))}
                  middle={
                    <NodeCardTagRow
                      tags={pencilCommands
                        .slice(0, 6)
                        .map((c) => c.cmd.replace(/^\//, "").toUpperCase())}
                    />
                  }
                />
              </motion.div>
              <motion.div variants={fadeUp}>
                <NodeCard
                  index="03"
                  title={"MARCO\nBOT"}
                  icon={Robot01Icon}
                  stat={String(botCounts.marco)}
                  statLabel="Macros"
                  active={activeBot === "marco"}
                  onClick={() => setActiveBot((prev) => (prev === "marco" ? "all" : "marco"))}
                  middle={
                    <NodeCardSparkline
                      heights={marcoMacros
                        .slice(0, 12)
                        .map((m, i) => 30 + ((m.name.length * 7 + i * 13) % 60))}
                    />
                  }
                />
              </motion.div>
            </motion.div>

            <motion.div variants={fadeUp}>
              <CommandLegend />
            </motion.div>
          </div>

          {/* RIGHT: command terminal */}
          <motion.div variants={fadeLeft} className="flex flex-1 [&>*]:flex-1">
            <CommandTerminal
              entries={filteredEntries}
              totalCount={allEntries.length}
              category={category}
              onCategoryChange={setCategory}
              search={search}
              onSearchChange={setSearch}
              scopeLabel={scopeLabel}
            />
          </motion.div>
        </div>
      </motion.div>
    </GlitchTransition>
  );
}

// Re-export categories for anyone wanting the list
export { COMMAND_CATEGORIES };
