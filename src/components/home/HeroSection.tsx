import { ComputerTerminal01Icon, IdentityCardIcon, UserGroupIcon } from '@hugeicons/core-free-icons';
import type { IconSvgElement } from '@hugeicons/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Link } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { useMagnetic } from '@/lib/hooks/use-cursor';
import { CyclingWord } from './CyclingWord';

const springTransition = { type: 'spring', stiffness: 1000, damping: 30, mass: 0.1 } as const;

interface NavItem {
  id: string;
  label: string;
  icon: IconSvgElement;
  to: string;
}

function NavCard({ item }: { item: NavItem }) {
  const { ref, position } = useMagnetic(0.2);
  return (
    <motion.div
      ref={ref as React.RefObject<HTMLDivElement>}
      data-magnetic
      data-cursor-corner-size="lg"
      data-cursor-padding-x="24"
      data-cursor-padding-y="24"
      animate={{ x: position.x, y: position.y }}
      transition={springTransition}
      className="relative z-10 w-full sm:w-auto"
    >
      <Link
        to={item.to}
        className="group flex h-24 w-full min-w-[200px] flex-col justify-between border-2 border-muted bg-card p-4 transition-all duration-100 hover:-translate-y-1 hover:border-primary hover:bg-background hover:shadow-[4px_4px_0px_var(--color-primary)] active:translate-y-0 active:shadow-none"
      >
        <div className="flex justify-between">
          <span className="font-mono text-xs text-muted-foreground group-hover:text-primary">{item.id}</span>
          <HugeiconsIcon icon={item.icon} size={20} className="text-muted-foreground group-hover:text-primary" />
        </div>
        <div className="font-mono font-bold text-2xl leading-none tracking-tight text-foreground group-hover:text-primary whitespace-pre-line">
          {item.label}
        </div>
      </Link>
    </motion.div>
  );
}

const NAV_ITEMS = [
  { id: '01', label: 'COLLAB\nBOARD', icon: UserGroupIcon, to: '/collab' },
  { id: '02', label: 'COMMAND\nCENTER', icon: ComputerTerminal01Icon, to: '/command-center' },
  { id: '03', label: 'DEV\nPROFILE', icon: IdentityCardIcon, to: '/profile' },
];

export function HeroSection() {
  return (
    <div className="flex w-full h-full flex-col justify-between">
      <div className="mb-4 flex items-center gap-2 font-mono text-xs tracking-widest text-muted-foreground">
        <span className="text-primary">{'>'}</span>
        {'SYSTEM READY'}
        <span className="mx-2 text-primary">{'//'}</span>
        {'v0.0.0-alpha.127'}
        <span className="mx-2 text-primary">{'//'}</span>
        {'WELCOME USER'}
      </div>

      <div className="flex flex-col justify-center">
        <h1 className="font-mono font-bold text-[clamp(3rem,8vw,11rem)] leading-[0.85] tracking-tighter text-foreground lg:text-[9rem] xl:text-[11rem]">
          <CyclingWord />
          <br />
          <span className="text-transparent [-webkit-text-stroke:1px_var(--color-primary)] hover:text-primary transition-colors duration-300">
            GAMES.
          </span>
        </h1>
        <p className="mt-8 max-w-xl font-sans text-lg text-muted-foreground lg:text-xl">
          The central neural network for the Brackeys Game Dev community.
          Find your squad, access the knowledge base, and deploy your build.
        </p>
      </div>

      <nav className="my-6 sm:mt-12 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
        {NAV_ITEMS.map((item) => (
          <NavCard key={item.id} item={item} />
        ))}
      </nav>
    </div>
  );
}
