import {
  CodeIcon,
  GameController01Icon,
  IdentityCardIcon,
  Login01Icon,
} from '@hugeicons/core-free-icons';
import type { IconSvgElement } from '@hugeicons/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { useStore } from '@tanstack/react-store';
import { motion } from 'framer-motion';
import { authClient } from '@/lib/auth-client';
import { authStore } from '@/lib/auth-store';
import { useMagnetic } from '@/lib/hooks/use-cursor';
import { usePageSidebar } from '@/lib/hooks/use-page-layout';
import { ProfileBuilderSidebar } from './ProfileBuilderSidebar';

const springTransition = { type: 'spring', stiffness: 1000, damping: 30, mass: 0.1 } as const;

interface ProfileNavItem {
  id: string;
  label: string;
  icon: IconSvgElement;
  desc: string;
}

const NAV_CARDS: ProfileNavItem[] = [
  {
    id: '01',
    label: 'SKILLS\nSTACK',
    icon: CodeIcon,
    desc: 'Languages, engines & tools',
  },
  {
    id: '02',
    label: 'PROJECT\nSHOWCASE',
    icon: IdentityCardIcon,
    desc: 'Your shipped builds',
  },
  {
    id: '03',
    label: 'JAM\nHISTORY',
    icon: GameController01Icon,
    desc: 'Competition track record',
  },
];

function ProfileNavCard({ card }: { card: ProfileNavItem }) {
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
      <div className="group flex h-24 w-full min-w-[200px] flex-col justify-between border-2 border-muted bg-card p-4 transition-all duration-100 hover:-translate-y-1 hover:border-primary hover:bg-background hover:shadow-[4px_4px_0px_var(--color-primary)]">
        <div className="flex justify-between">
          <span className="font-mono text-xs text-muted-foreground group-hover:text-primary">{card.id}</span>
          <HugeiconsIcon icon={card.icon} size={20} className="text-muted-foreground group-hover:text-primary" />
        </div>
        <div className="font-mono font-bold text-2xl leading-none tracking-tight text-foreground group-hover:text-primary whitespace-pre-line">
          {card.label}
        </div>
      </div>
    </motion.div>
  );
}

function DiscordSignInCTA() {
  const { ref, position } = useMagnetic(0.2);
  return (
    <div className="my-6 sm:mt-12">
      <motion.div
        ref={ref as React.RefObject<HTMLDivElement>}
        data-magnetic
        data-cursor-corner-size="lg"
        data-cursor-padding-x="24"
        data-cursor-padding-y="24"
        animate={{ x: position.x, y: position.y }}
        transition={springTransition}
        className="relative z-10 inline-block"
      >
        <button
          type="button"
          onClick={() => authClient.signIn.social({ provider: 'discord' })}
          className="group flex h-24 min-w-[280px] flex-col justify-between border-2 border-primary bg-card p-4 text-left transition-all duration-100 hover:-translate-y-1 hover:bg-background hover:shadow-[4px_4px_0px_var(--color-primary)] active:translate-y-0 active:shadow-none"
        >
          <div className="flex justify-between">
            <span className="font-mono text-xs text-primary">AUTHENTICATE</span>
            <HugeiconsIcon icon={Login01Icon} size={20} className="text-primary" />
          </div>
          <div className="font-mono font-bold text-2xl leading-none tracking-tight text-primary whitespace-pre-line">
            {'SIGN IN\nW/ DISCORD'}
          </div>
        </button>
      </motion.div>
      <p className="mt-4 font-mono text-xs text-muted-foreground tracking-wider">
        {'> AUTHENTICATION REQUIRED TO ACCESS PROFILE EDITOR'}
      </p>
    </div>
  );
}

export function ProfileBuilderPage() {
  const { session, isPending } = useStore(authStore);

  usePageSidebar(<ProfileBuilderSidebar />);

  const agentName = isPending
    ? 'LOADING...'
    : session?.user?.name
      ? session.user.name.toUpperCase()
      : 'UNAUTHORIZED';

  return (
    <>
      {/* Status bar */}
      <div className="mb-4 flex items-center gap-2 font-mono text-xs tracking-widest text-muted-foreground">
        <span className="text-primary">{'>'}</span>
        {'SYSTEM READY'}
        <span className="mx-2 text-primary">{'//'}</span>
        {'v0.0.0-alpha.127'}
        <span className="mx-2 text-primary">{'//'}</span>
        {'AGENT: '}
        <span className={session?.user ? 'text-primary' : 'text-destructive'}>{agentName}</span>
      </div>

      {/* Heading block */}
      <div className="flex flex-col justify-center">
        <h1 className="font-mono font-bold text-[clamp(3rem,8vw,11rem)] leading-[0.85] tracking-tighter text-foreground lg:text-[9rem] xl:text-[11rem]">
          DEV
          <br />
          <span className="text-transparent [-webkit-text-stroke:1px_var(--color-primary)] hover:text-primary transition-colors duration-300">
            PROFILE.
          </span>
        </h1>
        <p className="mt-8 max-w-xl font-sans text-lg text-muted-foreground lg:text-xl">
          Your developer identity in the Brackeys network.
          Showcase your skills, ship your projects, and track your jam history.
        </p>
      </div>

      {/* Nav cards or sign-in CTA */}
      {session?.user ? (
        <nav className="my-6 sm:mt-12 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          {NAV_CARDS.map((card) => (
            <ProfileNavCard key={card.id} card={card} />
          ))}
        </nav>
      ) : (
        <DiscordSignInCTA />
      )}
    </>
  );
}
