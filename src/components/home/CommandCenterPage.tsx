import {
  LegalHammerIcon,
  PencilIcon,
  Robot01Icon,
} from '@hugeicons/core-free-icons';
import type { IconSvgElement } from '@hugeicons/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import type { BotId } from '@/data/commands';
import {
  allBotCommands,
  hammerCommands,
  marcoMacros,
  pencilCommands,
} from '@/data/commands';
import { useMagnetic } from '@/lib/hooks/use-cursor';
import { usePageSidebar } from '@/lib/hooks/use-page-layout';
import { CommandCenterSidebar } from './CommandCenterSidebar';

type ActiveBot = 'all' | BotId;

const springTransition = { type: 'spring', stiffness: 1000, damping: 30, mass: 0.1 } as const;

interface BotCard {
  id: ActiveBot;
  label: string;
  index: string;
  icon: IconSvgElement;
  desc: string;
}

const BOT_CARDS: BotCard[] = [
  {
    id: 'hammer',
    index: '01',
    label: 'HAMMER\nBOT',
    icon: LegalHammerIcon,
    desc: 'Enforcement & rule lookups',
  },
  {
    id: 'pencil',
    index: '02',
    label: 'PENCIL\nBOT',
    icon: PencilIcon,
    desc: 'Color & TeX rendering tools',
  },
  {
    id: 'marco',
    index: '03',
    label: 'MARCO\nBOT',
    icon: Robot01Icon,
    desc: `${marcoMacros.length} community macros`,
  },
];

function BotNavCard({
  card,
  isActive,
  onClick,
}: {
  card: BotCard;
  isActive: boolean;
  onClick: () => void;
}) {
  const { ref, position } = useMagnetic(0.2);
  return (
    <motion.div
      ref={ref as React.RefObject<HTMLDivElement>}
      {...(!isActive && {
        'data-magnetic': true,
        'data-cursor-corner-size': 'lg',
        'data-cursor-padding-x': '24',
        'data-cursor-padding-y': '24',
      })}
      animate={{ x: isActive ? 0 : position.x, y: isActive ? 0 : position.y }}
      transition={springTransition}
      className="relative z-10 w-full sm:w-auto"
    >
      <button
        type="button"
        onClick={onClick}
        className={`group flex h-24 w-full min-w-[200px] flex-col justify-between border-2 bg-card p-4 text-left transition-all duration-100 ${
          isActive
            ? 'border-primary shadow-[4px_4px_0px_var(--color-primary)] cursor-default'
            : 'border-muted hover:-translate-y-1 hover:border-primary hover:bg-background hover:shadow-[4px_4px_0px_var(--color-primary)] active:translate-y-0 active:shadow-none'
        }`}
      >
        <div className="flex justify-between">
          <span className={`font-mono text-xs ${isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-primary'}`}>
            {card.index}
          </span>
          <HugeiconsIcon
            icon={card.icon}
            size={20}
            className={isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-primary'}
          />
        </div>
        <div className={`font-mono font-bold text-2xl leading-none tracking-tight whitespace-pre-line ${isActive ? 'text-primary' : 'text-foreground group-hover:text-primary'}`}>
          {card.label}
        </div>
      </button>
    </motion.div>
  );
}

export function CommandCenterPage() {
  const [search, setSearch] = useState('');
  const [activeBot, setActiveBot] = useState<ActiveBot>('all');

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

  usePageSidebar(
    <CommandCenterSidebar
      search={search}
      onSearch={setSearch}
      activeBot={activeBot}
      onBotChange={setActiveBot}
      filteredCommands={filteredCommands}
      filteredMacros={filteredMacros}
      totalResults={totalResults}
      hasNoResults={hasNoResults}
      showCommandSection={showCommandSection}
      showMacroSection={showMacroSection}
      showMacroHeader={showMacroHeader}
    />,
  );

  return (
    <>
      {/* Status bar — mirrors HeroSection top bar */}
      <div className="mb-4 flex items-center gap-2 font-mono text-xs tracking-widest text-muted-foreground">
        <span className="text-primary">{'>'}</span>
        {'SYSTEM READY'}
        <span className="mx-2 text-primary">{'//'}</span>
        {'v0.0.0-alpha.127'}
        <span className="mx-2 text-primary">{'//'}</span>
        {'WELCOME USER'}
      </div>

      {/* Heading block */}
      <div className="flex flex-col justify-center">
        <h1 className="font-mono font-bold text-[clamp(3rem,15vw,11rem)] leading-[0.85] tracking-tighter text-foreground lg:text-[9rem] xl:text-[11rem]">
          BOT
          <br />
          <span className="text-transparent [-webkit-text-stroke:1px_var(--color-primary)] hover:text-primary transition-colors duration-300">
            DOCS.
          </span>
        </h1>
        <p className="mt-8 max-w-xl font-sans text-lg text-muted-foreground lg:text-xl">
          Full command reference for every bot in the Brackeys server.
          Filter by bot or search for a specific command.
        </p>
      </div>

      {/* Bot nav cards — same style as HeroSection NavCards */}
      <nav className="my-6 sm:mt-12 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
        {BOT_CARDS.map((card) => (
          <BotNavCard
            key={card.id}
            card={card}
            isActive={activeBot === card.id}
            onClick={() => {
              setActiveBot(card.id);
              setSearch('');
            }}
          />
        ))}
      </nav>
    </>
  );
}
