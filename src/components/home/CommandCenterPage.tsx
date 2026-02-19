import { useMemo, useRef, useState } from 'react';
import {
  AlertCircleIcon,
  CheckListIcon,
  LegalHammerIcon,
  PencilIcon,
  Robot01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { CommandRow } from './CommandRow';
import { MacroRow } from './MacroRow';
import {
  allBotCommands,
  hammerCommands,
  marcoMacros,
  pencilCommands,
} from '@/data/commands';
import type { BotId } from '@/data/commands';

type ActiveBot = 'all' | BotId;

const BOT_TABS: { id: ActiveBot; label: string }[] = [
  { id: 'all', label: 'ALL' },
  { id: 'hammer', label: 'HAMMER' },
  { id: 'pencil', label: 'PENCIL' },
  { id: 'marco', label: 'MARCO' },
];

const botCards = [
  {
    id: 'hammer',
    title: 'HAMMER',
    icon: LegalHammerIcon,
    desc: 'Enforcement bot for rule lookups and infraction management. Keeps the server in check.',
    commandCount: hammerCommands.length,
  },
  {
    id: 'pencil',
    title: 'PENCIL',
    icon: PencilIcon,
    desc: 'Utility bot for color inspection and TeX rendering. Visual tools for creative folks.',
    commandCount: pencilCommands.length,
  },
  {
    id: 'marco',
    title: 'MARCO',
    icon: Robot01Icon,
    desc: `Macro bot with ${marcoMacros.length} community shortcuts. Invokable with / or [] prefix.`,
    commandCount: marcoMacros.length,
  },
];

export function CommandCenterPage() {
  const [search, setSearch] = useState('');
  const [activeBot, setActiveBot] = useState<ActiveBot>('all');
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredCommands = useMemo(() => {
    const q = search.toLowerCase();

    let pool = allBotCommands;
    if (activeBot === 'hammer') pool = hammerCommands;
    else if (activeBot === 'pencil') pool = pencilCommands;
    else if (activeBot === 'marco') return [];

    if (!q) return pool;
    return pool.filter(
      (c) =>
        c.cmd.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.params?.toLowerCase().includes(q),
    );
  }, [search, activeBot]);

  const filteredMacros = useMemo(() => {
    if (activeBot === 'hammer' || activeBot === 'pencil') return [];
    const q = search.toLowerCase();
    if (!q) return marcoMacros;
    return marcoMacros.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.aliases.some((a) => a.toLowerCase().includes(q)),
    );
  }, [search, activeBot]);

  const showCommandSection = filteredCommands.length > 0;
  const showMacroSection = filteredMacros.length > 0;
  const showMacroHeader = activeBot === 'all' && showCommandSection && showMacroSection;
  const totalResults = filteredCommands.length + filteredMacros.length;
  const hasNoResults = search.length > 0 && totalResults === 0;

  const handleTabChange = (tab: ActiveBot) => {
    setActiveBot(tab);
    setSearch('');
    inputRef.current?.focus();
  };

  return (
    <div className="bg-background text-foreground min-h-[calc(100vh-57px)] flex flex-col relative selection:bg-primary selection:text-white">
      {/* Background Grid */}
      <div
        className="fixed inset-0 z-0 pointer-events-none opacity-5"
        style={{
          backgroundImage:
            'linear-gradient(#6B6B6B 1px, transparent 1px), linear-gradient(90deg, #6B6B6B 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* CRT Scanline Overlay */}
      <div
        className="fixed inset-0 z-55 pointer-events-none opacity-10"
        style={{
          background:
            'linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0) 50%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.2))',
          backgroundSize: '100% 4px',
        }}
      />

      <div className="relative z-10 flex flex-col flex-1">
        <main className="flex-1 flex flex-col p-4 md:p-8 max-w-5xl mx-auto w-full gap-8">
          {/* Page Header */}
          <section className="flex flex-col gap-2 mt-4">
            <div className="flex items-center gap-3 text-primary mb-1">
              <HugeiconsIcon icon={CheckListIcon} size={20} className="animate-pulse" />
              <span className="font-mono text-sm tracking-widest uppercase">
                {'System Online // Database Connected'}
              </span>
            </div>
            <h1 className="text-foreground font-sans font-bold text-4xl md:text-6xl lg:text-7xl uppercase leading-[0.9] tracking-tighter">
              Bot_Documentation<span className="text-primary">_V.1.0</span>
            </h1>
            <p className="text-muted-foreground font-mono max-w-2xl mt-2 text-sm md:text-base border-l-2 border-muted pl-4">
              {'// ACCESS LEVEL: UNRESTRICTED'} <br />
              {'// USE SEARCH TO FILTER COMMAND PROTOCOLS.'}
            </p>
          </section>

          {/* Terminal Interface */}
          <div className="flex flex-col shadow-[4px_4px_0px_var(--color-primary)] border-2 border-primary bg-[#0a0a0a]">
            {/* Title bar */}
            <div className="bg-primary text-black px-4 py-1 flex justify-between items-center font-mono text-xs font-bold select-none">
              <span>ROOT@BRACKEYS-SERVER:~</span>
              <span>BASH_V3.2</span>
            </div>

            {/* Bot Tabs */}
            <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-muted/20 bg-[#0d0d0d] flex-wrap">
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
            <div className="p-6 border-b border-muted/30 bg-[#121212]">
              <div className="relative flex items-center w-full">
                <span className="text-primary font-mono text-xl mr-3 font-bold">&gt;</span>
                <input
                  ref={inputRef}
                  autoComplete="off"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setSearch('')}
                  className="w-full bg-transparent border-none focus:ring-0 p-0 text-xl font-mono text-cyan-400 placeholder-muted/50 caret-transparent uppercase outline-none"
                  placeholder="TYPE COMMAND SEARCH..."
                  spellCheck="false"
                  type="text"
                />
                <div className="absolute right-0 top-1/2 -translate-y-1/2 hidden md:flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground bg-card px-2 py-1 border border-muted">
                    ESC to clear
                  </span>
                </div>
                <span className="absolute left-[calc(1.25rem+1.5rem+12px)] top-1/2 -translate-y-1/2 w-3 h-6 bg-primary animate-[blink_1s_step-end_infinite] hidden md:block" />
              </div>
            </div>

            {/* Content List */}
            <div className="flex flex-col max-h-[560px] overflow-y-auto divide-y divide-muted/20">
              {/* Bot Commands */}
              {showCommandSection &&
                filteredCommands.map((cmd) => <CommandRow key={cmd.id} command={cmd} />)}

              {/* Macro Section Header */}
              {showMacroHeader && (
                <div className="flex items-center gap-3 px-5 py-3 bg-[#0d0d16]">
                  <HugeiconsIcon icon={Robot01Icon} size={14} className="text-muted-foreground" />
                  <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                    Marco Macro Protocols — works with / or [] prefix
                  </span>
                </div>
              )}

              {/* Marco note header (when marco tab only) */}
              {activeBot === 'marco' && !search && (
                <div className="flex items-center gap-3 px-5 py-3 bg-[#0d0d16]">
                  <HugeiconsIcon icon={Robot01Icon} size={14} className="text-muted-foreground" />
                  <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
                    {marcoMacros.length} macros — invokable with / or [] prefix
                  </span>
                </div>
              )}

              {/* Macros */}
              {showMacroSection && (
                <ul className="flex flex-col divide-y divide-muted/20">
                  {filteredMacros.map((macro) => (
                    <MacroRow key={macro.name} macro={macro} />
                  ))}
                </ul>
              )}

              {/* No Results */}
              {hasNoResults && (
                <div className="p-6 bg-[#1a0a0a] border-l-4 border-destructive/50 flex items-start gap-4">
                  <HugeiconsIcon
                    icon={AlertCircleIcon}
                    size={20}
                    className="text-destructive mt-0.5 shrink-0"
                  />
                  <div>
                    <h4 className="text-destructive font-mono font-bold uppercase mb-1">
                      System Error: 404
                    </h4>
                    <p className="text-muted-foreground font-mono text-sm">
                      COMMAND &quot;{search}&quot; NOT FOUND IN DATABASE.
                    </p>
                  </div>
                </div>
              )}

              {/* Default error easter egg (only when not searching and showing all commands) */}
              {!search && activeBot !== 'marco' && (
                <div className="p-6 bg-[#1a0a0a] border-l-4 border-destructive/50 flex items-start gap-4">
                  <HugeiconsIcon
                    icon={AlertCircleIcon}
                    size={20}
                    className="text-destructive mt-0.5 shrink-0"
                  />
                  <div>
                    <h4 className="text-destructive font-mono font-bold uppercase mb-1">
                      System Error: 404
                    </h4>
                    <p className="text-muted-foreground font-mono text-sm">
                      COMMAND &quot;sudo hack mainframe&quot; NOT RECOGNIZED. ACCESS DENIED.
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-[#0a0a0a] border-t border-muted/20 p-2 flex justify-end">
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest animate-pulse">
                Awaiting Input...
              </span>
            </div>
          </div>

          {/* Bot Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
            {botCards.map((bot) => (
              <div
                key={bot.id}
                className="bg-card border-2 border-muted p-4 hover:border-cyan-400 group transition-colors relative z-10"
              >
                <div className="flex justify-between items-start mb-2">
                  <h3 className="font-sans font-bold text-foreground text-lg">{bot.title}</h3>
                  <HugeiconsIcon
                    icon={bot.icon}
                    size={20}
                    className="text-muted-foreground group-hover:text-cyan-400 transition-colors"
                  />
                </div>
                <p className="text-sm text-muted-foreground font-sans">{bot.desc}</p>
                <button
                  type="button"
                  onClick={() => {
                    setActiveBot(bot.id as ActiveBot);
                    setSearch('');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="inline-block mt-4 text-xs font-mono font-bold text-primary hover:text-foreground hover:underline uppercase"
                >
                  View Commands &gt;&gt;
                </button>
              </div>
            ))}
          </div>
        </main>

        <footer className="mt-auto border-t border-muted/30 py-6 text-center">
          <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
            {'Brackeys Community © 2025 // Built for Game Devs'}
          </p>
        </footer>
      </div>
    </div>
  );
}
