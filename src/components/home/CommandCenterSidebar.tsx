import { AlertCircleIcon, Robot01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { BotCommand, BotId, Macro } from "@/data/commands";
import { marcoMacros } from "@/data/commands";
import { NOTCH_SIZE, notchClip, notchClipInner } from "@/lib/notch";

import { CommandRow } from "./CommandRow";
import { MacroRow } from "./MacroRow";

type ActiveBot = "all" | BotId;

const BOT_TABS: { id: ActiveBot; label: string }[] = [
  { id: "all", label: "ALL" },
  { id: "hammer", label: "HAMMER" },
  { id: "pencil", label: "PENCIL" },
  { id: "marco", label: "MARCO" },
];

const IDLE_ERRORS = [
  {
    code: 218,
    title: "218 THIS IS FINE",
    msg: "EVERYTHING IS FINE. THE SERVER IS NOT ON FIRE. PLEASE ENTER A COMMAND.",
  },
  {
    code: 418,
    title: "418 I'M A TEAPOT",
    msg: "SERVER IS READY. NOT A COFFEE MACHINE. TYPE SOMETHING.",
  },
  {
    code: 420,
    title: "420 NOT BLAZED ENOUGH",
    msg: "NO QUERY DETECTED. SERVER VIBES INSUFFICIENT. START TYPING.",
  },
  {
    code: 451,
    title: "451 UNAVAILABLE FOR LEGAL REASONS",
    msg: "ALL COMMANDS REDACTED UNTIL SEARCH QUERY RECEIVED. FAHRENHEIT 451.",
  },
] as const;

type VItem =
  | { type: "command"; data: BotCommand }
  | { type: "macro-header" }
  | { type: "marco-header" }
  | { type: "macro"; data: Macro }
  | { type: "error"; code: number; title: string; msg: string };

interface CommandCenterSidebarProps {
  search: string;
  onSearch: (value: string) => void;
  activeBot: ActiveBot;
  onBotChange: (bot: ActiveBot) => void;
  filteredCommands: BotCommand[];
  filteredMacros: typeof marcoMacros;
  totalResults: number;
  hasNoResults: boolean;
  showCommandSection: boolean;
  showMacroSection: boolean;
  showMacroHeader: boolean;
}

export function CommandCenterSidebar({
  search,
  onSearch,
  activeBot,
  onBotChange,
  filteredCommands,
  filteredMacros,
  totalResults,
  hasNoResults,
  showCommandSection,
  showMacroSection,
  showMacroHeader,
}: CommandCenterSidebarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLSpanElement>(null);
  const [cursorX, setCursorX] = useState(0);
  const [viewport, setViewport] = useState<Element | null>(null);

  const handleTabChange = (tab: ActiveBot) => {
    onBotChange(tab);
    onSearch("");
    inputRef.current?.focus();
  };

  // Block cursor: measure text width up to caret position using a hidden mirror span
  const updateCursor = useCallback(() => {
    const input = inputRef.current;
    const mirror = mirrorRef.current;
    if (!input || !mirror) return;
    const pos = input.selectionStart ?? input.value.length;
    mirror.textContent = input.value.slice(0, pos).toUpperCase();
    setCursorX(mirror.getBoundingClientRect().width - (input.scrollLeft ?? 0));
  }, []);

  // Focus on mount without using the banned autoFocus attribute
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: search is an intentional trigger to recalculate cursor after controlled updates
  useLayoutEffect(() => {
    updateCursor();
  }, [search, updateCursor]);

  const idleError = useMemo(() => {
    const idxMap: Record<ActiveBot, number> = { all: 0, hammer: 1, pencil: 2, marco: 3 };
    return IDLE_ERRORS[(idxMap[activeBot] ?? 0) % IDLE_ERRORS.length];
  }, [activeBot]);

  // Flatten everything into a single list for the virtualizer
  const items = useMemo<VItem[]>(() => {
    const result: VItem[] = [];
    if (showCommandSection) {
      for (const cmd of filteredCommands) result.push({ type: "command", data: cmd });
    }
    if (showMacroHeader) result.push({ type: "macro-header" });
    if (activeBot === "marco" && !search) result.push({ type: "marco-header" });
    if (showMacroSection) {
      for (const macro of filteredMacros) result.push({ type: "macro", data: macro });
    }
    if (hasNoResults)
      result.push({
        type: "error",
        code: 404,
        title: "404 NOT FOUND",
        msg: `COMMAND "${search}" NOT FOUND IN DATABASE.`,
      });
    if (!search && activeBot !== "marco") result.push({ type: "error", ...idleError });
    return result;
  }, [
    filteredCommands,
    filteredMacros,
    showCommandSection,
    showMacroSection,
    showMacroHeader,
    hasNoResults,
    activeBot,
    search,
    idleError,
  ]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => viewport,
    estimateSize: (i) => {
      const item = items[i];
      if (item.type === "command") return 120;
      if (item.type === "macro") return 48;
      return 48;
    },
    measureElement: (el) => el.getBoundingClientRect().height,
    getItemKey: (i) => {
      const item = items[i];
      if (item.type === "command") return `cmd-${item.data.id}`;
      if (item.type === "macro") return `macro-${item.data.name}`;
      return item.type;
    },
  });

  // Capture the OverlayScrollbars viewport once initialized so the virtualizer
  // has the actual scrollable element to observe
  const osEvents = useMemo(
    () => ({
      initialized: (instance: { elements(): { viewport: Element } }) =>
        setViewport(instance.elements().viewport),
    }),
    [],
  );

  return (
    <div className="flex min-h-0 flex-1 p-6 selection:bg-primary selection:text-white">
      <div
        className="pointer-events-auto min-h-0 min-w-0 flex-1 bg-muted/60"
        style={{ clipPath: notchClip, padding: "2px" }}
      >
        <div
          className="relative flex h-full flex-col overflow-hidden bg-[#0a0a0a]"
          style={{ clipPath: notchClipInner }}
        >
          {/* Corner decorators */}
          <span className="pointer-events-none absolute top-0 left-0 z-10 h-2 w-2 border-t border-l border-brackeys-yellow/50" />
          <span className="pointer-events-none absolute right-0 bottom-0 z-10 h-2 w-2 border-r border-b border-brackeys-yellow/50" />
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute top-0 right-0 z-10 text-brackeys-yellow/40"
            width={NOTCH_SIZE + 2}
            height={NOTCH_SIZE + 2}
            viewBox={`0 0 ${NOTCH_SIZE + 2} ${NOTCH_SIZE + 2}`}
            fill="none"
          >
            <line
              x1="0"
              y1="1"
              x2={NOTCH_SIZE + 1}
              y2={NOTCH_SIZE + 2}
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 left-0 z-10 text-brackeys-yellow/40"
            width={NOTCH_SIZE + 2}
            height={NOTCH_SIZE + 2}
            viewBox={`0 0 ${NOTCH_SIZE + 2} ${NOTCH_SIZE + 2}`}
            fill="none"
          >
            <line
              x1={NOTCH_SIZE + 1}
              y1={NOTCH_SIZE + 1}
              x2="0"
              y2="0"
              stroke="currentColor"
              strokeWidth="1"
            />
          </svg>

          {/* Title bar */}
          <div className="flex shrink-0 items-center justify-between px-4 py-2.5 font-mono text-xs font-bold text-muted-foreground select-none">
            <span>ROOT@BRACKEYS-SERVER:~</span>
            <span>
              {totalResults} PROTOCOL{totalResults !== 1 ? "S" : ""} LOADED
            </span>
          </div>

          {/* Bot filter tabs (mobile — on desktop these are in the left column nav cards) */}
          <div className="flex shrink-0 border-b border-muted/30 lg:hidden">
            {BOT_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={`flex-1 py-2 font-mono text-[10px] font-bold tracking-widest uppercase transition-colors ${
                  activeBot === tab.id
                    ? "border-b-2 border-primary text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Bar */}
          <div className="shrink-0 border-b border-muted/30 bg-[#121212] px-4 py-4">
            <div className="flex w-full items-center gap-3">
              <span className="shrink-0 font-mono text-lg leading-none font-bold text-primary">
                &gt;
              </span>
              {/* Wrapper provides positioning context for the block cursor */}
              <div className="relative flex-1 overflow-hidden">
                {/* Hidden mirror span used to measure text width at caret position */}
                <span
                  ref={mirrorRef}
                  aria-hidden
                  className="pointer-events-none invisible absolute top-0 left-0 font-mono text-base whitespace-pre uppercase"
                />
                <input
                  ref={inputRef}
                  autoComplete="off"
                  value={search}
                  onChange={(e) => onSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && onSearch("")}
                  onBlur={() => {}}
                  onSelect={updateCursor}
                  onKeyUp={updateCursor}
                  className="w-full border-none bg-transparent p-0 font-mono text-base text-brackeys-yellow uppercase placeholder-muted/50 caret-transparent outline-none focus:ring-0"
                  placeholder="SEARCH COMMANDS..."
                  spellCheck="false"
                  type="text"
                />
                {/* Block cursor — positioned by measured text width */}
                <span
                  className="pointer-events-none absolute top-1/2 h-[1.15em] w-[0.6em] -translate-y-1/2 bg-brackeys-yellow"
                  style={{ left: cursorX, animation: "terminal-blink 1.1s step-end infinite" }}
                />
              </div>
            </div>
          </div>

          {/* Virtualized content list */}
          <OverlayScrollbarsComponent
            element="div"
            className="min-h-0 flex-1"
            options={{
              scrollbars: {
                theme: "os-theme-dark",
                autoHide: "scroll",
                autoHideDelay: 800,
              },
            }}
            events={osEvents}
          >
            <div
              style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}
            >
              {virtualizer.getVirtualItems().map((vItem) => {
                const item = items[vItem.index];
                return (
                  <div
                    key={vItem.key}
                    data-index={vItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${vItem.start}px)`,
                    }}
                    className="border-b border-muted/20"
                  >
                    {item.type === "command" && <CommandRow command={item.data} />}

                    {item.type === "macro" && <MacroRow macro={item.data} />}

                    {(item.type === "macro-header" || item.type === "marco-header") && (
                      <div className="flex items-center gap-3 bg-[#0d0d16] px-5 py-3">
                        <HugeiconsIcon
                          icon={Robot01Icon}
                          size={14}
                          className="text-muted-foreground"
                        />
                        <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
                          Marco Macros: use /macro name:macroname or []macroname
                        </span>
                      </div>
                    )}

                    {item.type === "error" && (
                      <div className="flex items-start gap-4 border-l-4 border-destructive/50 bg-[#1a0a0a] p-6">
                        <HugeiconsIcon
                          icon={AlertCircleIcon}
                          size={20}
                          className="mt-0.5 shrink-0 text-destructive"
                        />
                        <div>
                          <h4 className="mb-1 font-mono font-bold text-destructive uppercase">
                            System Error: {item.title}
                          </h4>
                          <p className="font-mono text-sm text-muted-foreground">{item.msg}</p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </OverlayScrollbarsComponent>

          {/* Footer */}
          <div className="flex shrink-0 justify-end border-t border-muted/20 bg-[#0a0a0a] px-4 py-2">
            <span className="animate-pulse font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
              Awaiting Input...
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
