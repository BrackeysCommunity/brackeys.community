import {
  ComputerTerminal01Icon,
  LegalHammerIcon,
  PencilIcon,
  Robot01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useStore } from "@tanstack/react-store";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import { CommandRow, type CommandRowData } from "@/components/commands/CommandRow";
import { GraphPaper } from "@/components/ui/graph-paper";
import { Kbd } from "@/components/ui/kbd";
import { PageStack } from "@/components/ui/page-motion";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ShelfHeader } from "@/components/ui/shelf-header";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";
import { Well } from "@/components/ui/well";
import { hammerCommands, marcoMacros, pencilCommands, PROTOCOL_COUNT } from "@/data/commands";
import type { BotId } from "@/data/commands";
import { activeUserStore } from "@/lib/active-user-store";
import { buildCopyText } from "@/lib/command-copy";
import { useLaneRelease } from "@/lib/hooks/use-lane-release";
import { fadeIn, fadeUp } from "@/lib/motion";

type ActiveBot = "all" | BotId;

const SEARCH_INPUT_ID = "command-center-search";

// ── Unified entry list ───────────────────────────────────────────────
// Commands and macros both flow into the same shelves. Commands keep
// their option-based copy text; macros use the `/macro name:…` form.

function buildEntries(username?: string): CommandRowData[] {
  const commands: CommandRowData[] = [...hammerCommands, ...pencilCommands].map((c) => {
    // Hide `mention` when no active username is set, render options as
    // `name: description` + optional required tag, and let buildCopyText
    // own the default-value formatting in the example.
    const visibleOptions = c.options?.filter((o) => username || o.name !== "mention") ?? [];
    const body = visibleOptions.length
      ? visibleOptions
          .map((o) => `- \`${o.name}\`: ${o.description}${o.required ? " _(required)_" : ""}`)
          .join("\n")
      : undefined;

    return {
      id: c.id,
      label: c.cmd,
      bot: c.bot,
      description: c.description,
      body,
      copyText: buildCopyText(c, username),
    };
  });

  // Marco macro descriptions use Discord-flavored conventions: `• ` bullets and
  // `<url>` autolinks. Convert bullets to markdown list syntax and ensure a
  // blank line precedes the list so marked parses it as a real <ul>.
  const normalizeMarkdown = (src: string) =>
    src.replace(/^• /gm, "- ").replace(/([^\n])\n(- )/g, "$1\n\n$2");

  const macros: CommandRowData[] = marcoMacros.map((m) => ({
    id: `macro:${m.name}`,
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

// ── Shelves & filters ────────────────────────────────────────────────

const SHELVES: { bot: BotId; title: string; blurb: string; unit: string }[] = [
  {
    bot: "hammer",
    title: "HAMMER",
    blurb: "moderation — rules, infractions, member lookups",
    unit: "COMMAND",
  },
  {
    bot: "pencil",
    title: "PENCIL",
    blurb: "utilities — colors and TeX, rendered inline",
    unit: "COMMAND",
  },
  {
    bot: "marco",
    title: "MARCO",
    blurb: "the macro library — summon a snippet by name or alias",
    unit: "MACRO",
  },
];

const BOT_FILTERS: { id: ActiveBot; label: string; icon: typeof LegalHammerIcon }[] = [
  { id: "all", label: "ALL", icon: ComputerTerminal01Icon },
  { id: "hammer", label: "HAMMER", icon: LegalHammerIcon },
  { id: "pencil", label: "PENCIL", icon: PencilIcon },
  { id: "marco", label: "MARCO", icon: Robot01Icon },
];

const BOT_BLURB: Record<ActiveBot, string> = {
  all: "Search across everything — names, aliases, and descriptions — or filter down to one bot.",
  hammer: "Hammer keeps the server in order: rules, infraction history, and member lookups.",
  pencil: "Pencil handles the utilities: color breakdowns and TeX rendered inline in chat.",
  marco: "Marco answers to []name and /macro — the community's reference snippets.",
};

// ── Page ─────────────────────────────────────────────────────────────

/**
 * `/command-center` — the bot command reference, on the same frame as
 * the jam and collab boards so the reference reads as part of the same
 * product: masthead hero with the bot filter, sticky search rail, and
 * one shelf per bot in the jams list dress.
 */
export function CommandCenterPage() {
  const [search, setSearch] = useState("");
  const [activeBot, setActiveBot] = useState<ActiveBot>("all");
  const user = useStore(activeUserStore);
  const username = user.profile?.discordUsername ?? undefined;

  // A callback ref rather than a `useRef`: see the jam board's toolbar.
  const [toolbarEl, setToolbarEl] = useState<HTMLDivElement | null>(null);
  const laneRelease = useLaneRelease(toolbarEl);

  const allEntries = useMemo(() => buildEntries(username), [username]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === "") return allEntries;
    return allEntries.filter((e) =>
      [e.label, e.description, e.body ?? "", ...(e.aliases ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [allEntries, search]);

  const visibleShelves = SHELVES.filter((s) => activeBot === "all" || s.bot === activeBot).map(
    (s) => ({ ...s, entries: filtered.filter((e) => e.bot === s.bot) }),
  );
  const shown = visibleShelves.reduce((n, s) => n + s.entries.length, 0);

  // `/` focuses the search rail, same as the collab board. Skipped while
  // typing in an input, textarea, or contenteditable.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable === true
      ) {
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        document.getElementById(SEARCH_INPUT_ID)?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <PageStack className="flex flex-col gap-5">
      <motion.div variants={fadeUp}>
        <CommandsHero activeBot={activeBot} onBotChange={setActiveBot} />
      </motion.div>

      {/* `fadeIn` rather than `fadeUp`: the search rail is sticky — see the
          variant's own note. */}
      <motion.div variants={fadeIn} className="flex flex-col gap-6">
        <div
          ref={setToolbarEl}
          data-cursor-occlude=""
          className="header-follow toolbar-band sticky top-0 z-20"
          style={{ marginBottom: laneRelease }}
        >
          <div className="flex flex-col gap-2">
            <SearchField
              id={SEARCH_INPUT_ID}
              value={search}
              onChange={setSearch}
              placeholder="search commands, macros, aliases"
              autoComplete="off"
              size="default"
              containerClassName="h-10 min-w-64 flex-1"
              className="text-[11px] tracking-widest"
            />
            <Text size="xs" variant="muted" align="right" className="tracking-widest tabular-nums">
              {shown}/{allEntries.length} COMMANDS
            </Text>
          </div>
        </div>

        {/* The wrapper hands the overhang back so it takes no space in flow. */}
        <div style={{ marginTop: -laneRelease }} className="flex flex-col gap-10">
          {shown === 0 ? (
            <Text
              as="div"
              size="sm"
              variant="muted"
              align="center"
              className="p-12 tracking-widest uppercase"
            >
              No commands match that search
            </Text>
          ) : (
            visibleShelves.map((shelf) =>
              shelf.entries.length === 0 ? null : (
                <section key={shelf.bot} className="flex flex-col gap-3">
                  <ShelfHeader
                    title={shelf.title}
                    blurb={shelf.blurb}
                    count={shelf.entries.length}
                    unit={shelf.unit}
                  />
                  <ul className="flex flex-col overflow-hidden rounded-md border border-muted/20">
                    {shelf.entries.map((entry, i) => (
                      <CommandRow
                        key={entry.id}
                        entry={entry}
                        className={i > 0 ? "border-t border-muted/20" : undefined}
                      />
                    ))}
                  </ul>
                </section>
              ),
            )
          )}
        </div>

        <Text size="sm" variant="muted" className="hidden items-center gap-1.5 lg:flex">
          Press <Kbd>/</Kbd> to search.
        </Text>
      </motion.div>
    </PageStack>
  );
}

/**
 * The reference's masthead, on the same frame as the jam and collab
 * heroes. The switcher filters the shelves to one bot; the blurb's tail
 * follows the selection the way the jams hero describes its active view.
 */
function CommandsHero({
  activeBot,
  onBotChange,
}: {
  activeBot: ActiveBot;
  onBotChange: (bot: ActiveBot) => void;
}) {
  return (
    <Well
      // Keeps the app bar pinned until you scroll past — see `useHideOnScrollDown`.
      data-header-hero
      notchOpts
      // The gradient is the surface's alone — see the team hero for why
      // it can't ride on the frame.
      surfaceClassName="bg-card bg-linear-to-br from-deboss-surface via-deboss-surface to-primary/12 backdrop-blur-none"
    >
      <GraphPaper fade="bottom-left" />
      <div className="relative flex flex-wrap items-end justify-between gap-6 p-6">
        <div className="flex max-w-prose min-w-64 flex-col gap-2">
          <MicroLabel>COMMAND CENTER</MicroLabel>
          <Heading as="h1" className="text-2xl tracking-widest uppercase">
            Every bot command
          </Heading>
          <Text size="sm" variant="muted">
            {PROTOCOL_COUNT} commands and macros across the Brackeys server bots.{" "}
            {BOT_BLURB[activeBot]}
          </Text>
        </div>
        <SegmentedControl
          value={activeBot}
          onChange={(v) => onBotChange(v as ActiveBot)}
          aria-label="Filter by bot"
        >
          {BOT_FILTERS.map(({ id, label, icon }) => (
            <SegmentedControl.Item
              key={id}
              value={id}
              icon={<HugeiconsIcon icon={icon} size={14} />}
              className="px-4 tracking-widest"
            >
              {label}
            </SegmentedControl.Item>
          ))}
        </SegmentedControl>
      </div>
    </Well>
  );
}
