import { AlertCircleIcon, Robot01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useRef } from 'react';
import { CommandRow } from './CommandRow';
import { MacroRow } from './MacroRow';
import type { BotId } from '@/data/commands';
import { marcoMacros } from '@/data/commands';

type ActiveBot = 'all' | BotId;

const NOTCH_SIZE = 22;
const notchClip = `polygon(0 0, calc(100% - ${NOTCH_SIZE}px) 0, 100% ${NOTCH_SIZE}px, 100% 100%, 0 100%)`;
const notchClipInner = `polygon(0 0, calc(100% - ${NOTCH_SIZE - 2}px) 0, 100% ${NOTCH_SIZE - 2}px, 100% 100%, 0 100%)`;

const BOT_TABS: { id: ActiveBot; label: string }[] = [
  { id: 'all', label: 'ALL' },
  { id: 'hammer', label: 'HAMMER' },
  { id: 'pencil', label: 'PENCIL' },
  { id: 'marco', label: 'MARCO' },
];

interface CommandCenterSidebarProps {
  search: string;
  onSearch: (value: string) => void;
  activeBot: ActiveBot;
  onBotChange: (bot: ActiveBot) => void;
  filteredCommands: Array<{ id: string; cmd: string; description: string; params?: string }>;
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

  const handleTabChange = (tab: ActiveBot) => {
    onBotChange(tab);
    onSearch('');
    inputRef.current?.focus();
  };

  return (
    <div className="flex-1 min-h-0 flex p-6 selection:bg-primary selection:text-white">
      {/* Notched border shell — matches Sidebar styling */}
      <div
        className="flex-1 min-h-0 min-w-0 bg-muted/60"
        style={{ clipPath: notchClip, padding: '2px' }}
      >
        <div
          className="flex flex-col h-full bg-[#0a0a0a] relative overflow-hidden"
          style={{ clipPath: notchClipInner }}
        >
          {/* Corner decorators */}
          <span className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-cyan-400/50 pointer-events-none z-10" />
          <span className="absolute top-0 left-0 w-2 h-2 border-t border-l border-cyan-400/50 pointer-events-none z-10" />
          {/* Notch corner accent line */}
          <svg
            aria-hidden="true"
            className="absolute top-0 right-0 pointer-events-none text-cyan-400/40 z-10"
            width={NOTCH_SIZE + 2}
            height={NOTCH_SIZE + 2}
            viewBox={`0 0 ${NOTCH_SIZE + 2} ${NOTCH_SIZE + 2}`}
            fill="none"
          >
            <line x1="0" y1="1" x2={NOTCH_SIZE + 1} y2={NOTCH_SIZE + 2} stroke="currentColor" strokeWidth="1" />
          </svg>

          {/* Title bar */}
          <div className="bg-primary text-black px-4 py-1.5 flex justify-between items-center font-mono text-xs font-bold select-none shrink-0">
            <span>ROOT@BRACKEYS-SERVER:~</span>
            <span>BASH_V3.2</span>
          </div>

          {/* Bot Tabs */}
          <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-muted/20 bg-[#0d0d0d] flex-wrap shrink-0">
            {BOT_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={`font-mono text-xs font-bold px-3 py-1 uppercase border transition-colors ${
                  activeBot === tab.id
                    ? 'bg-primary text-black border-primary'
                    : 'border-muted text-muted-foreground hover:border-primary hover:text-primary bg-black'
                }`}
              >
                {tab.label}
              </button>
            ))}
            <span className="ml-auto text-[10px] font-mono text-muted-foreground self-center">
              {totalResults} PROTOCOL{totalResults !== 1 ? 'S' : ''} LOADED
            </span>
          </div>

          {/* Search Bar */}
          <div className="px-4 py-4 border-b border-muted/30 bg-[#121212] shrink-0">
            <div className="relative flex items-center w-full">
              <span className="text-primary font-mono text-lg mr-3 font-bold">&gt;</span>
              <input
                ref={inputRef}
                autoComplete="off"
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && onSearch('')}
                className="w-full bg-transparent border-none focus:ring-0 p-0 text-base font-mono text-cyan-400 placeholder-muted/50 caret-transparent uppercase outline-none"
                placeholder="SEARCH COMMANDS..."
                spellCheck="false"
                type="text"
              />
              <span className="absolute left-[calc(1rem+1.125rem+12px)] top-1/2 -translate-y-1/2 w-2.5 h-5 bg-primary animate-[blink_1s_step-end_infinite]" />
            </div>
          </div>

          {/* Content List — scrollable */}
          <div className="flex flex-col flex-1 overflow-y-auto divide-y divide-muted/20">
            {showCommandSection &&
              filteredCommands.map((cmd) => <CommandRow key={cmd.id} command={cmd} />)}

            {showMacroHeader && (
              <div className="flex items-center gap-3 px-5 py-3 bg-[#0d0d16]">
                <HugeiconsIcon icon={Robot01Icon} size={14} className="text-muted-foreground" />
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                  Marco Macro Protocols — works with / or [] prefix
                </span>
              </div>
            )}

            {activeBot === 'marco' && !search && (
              <div className="flex items-center gap-3 px-5 py-3 bg-[#0d0d16]">
                <HugeiconsIcon icon={Robot01Icon} size={14} className="text-muted-foreground" />
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                  {marcoMacros.length} macros — invokable with / or [] prefix
                </span>
              </div>
            )}

            {showMacroSection && (
              <ul className="flex flex-col divide-y divide-muted/20">
                {filteredMacros.map((macro) => (
                  <MacroRow key={macro.name} macro={macro} />
                ))}
              </ul>
            )}

            {hasNoResults && (
              <div className="p-6 bg-[#1a0a0a] border-l-4 border-destructive/50 flex items-start gap-4">
                <HugeiconsIcon icon={AlertCircleIcon} size={20} className="text-destructive mt-0.5 shrink-0" />
                <div>
                  <h4 className="text-destructive font-mono font-bold uppercase mb-1">System Error: 404</h4>
                  <p className="text-muted-foreground font-mono text-sm">
                    COMMAND &quot;{search}&quot; NOT FOUND IN DATABASE.
                  </p>
                </div>
              </div>
            )}

            {!search && activeBot !== 'marco' && (
              <div className="p-6 bg-[#1a0a0a] border-l-4 border-destructive/50 flex items-start gap-4">
                <HugeiconsIcon icon={AlertCircleIcon} size={20} className="text-destructive mt-0.5 shrink-0" />
                <div>
                  <h4 className="text-destructive font-mono font-bold uppercase mb-1">System Error: 404</h4>
                  <p className="text-muted-foreground font-mono text-sm">
                    COMMAND &quot;sudo hack mainframe&quot; NOT RECOGNIZED. ACCESS DENIED.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-muted/20 px-4 py-2 flex justify-end shrink-0 bg-[#0a0a0a]">
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest animate-pulse">
              Awaiting Input...
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
