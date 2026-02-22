import { ComputerTerminal01Icon, IdentityCardIcon, UserGroupIcon } from '@hugeicons/core-free-icons';
import type { IconSvgElement } from '@hugeicons/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useMagnetic } from '@/lib/hooks/use-cursor';
import { usePageSidebar } from '@/lib/hooks/use-page-layout';
import { orpc } from '@/orpc/client';
import { Route } from '@/routes/profile.$userId';
import { ProfileViewSidebar } from './ProfileViewSidebar';

const springTransition = { type: 'spring', stiffness: 1000, damping: 30, mass: 0.1 } as const;

interface StatCardProps {
  index: string;
  label: string;
  value: number;
  icon: IconSvgElement;
}

function StatCard({ index, label, value, icon }: StatCardProps) {
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
          <span className="font-mono text-xs text-muted-foreground group-hover:text-primary">{index}</span>
          <HugeiconsIcon icon={icon} size={20} className="text-muted-foreground group-hover:text-primary" />
        </div>
        <div className="flex items-baseline gap-3">
          <span className="font-mono font-bold text-2xl leading-none tracking-tight text-foreground group-hover:text-primary">
            {value}
          </span>
          <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase">{label}</span>
        </div>
      </div>
    </motion.div>
  );
}

export function ProfileViewPage() {
  const { userId } = Route.useParams();

  const { data: profileData, isLoading } = useQuery({
    ...orpc.getProfile.queryOptions({ input: { userId } }),
    staleTime: 60 * 1000,
  });

  const profile = profileData?.profile;
  const username = profile?.discordUsername ?? 'UNKNOWN';
  const tagline = profile?.tagline || 'A member of the Brackeys community.';

  usePageSidebar(
    <ProfileViewSidebar profileData={profileData ?? null} isLoading={isLoading} />,
  );

  return (
    <div className="flex w-full h-full flex-col justify-between p-6 lg:p-12 xl:p-16 selection:bg-primary selection:text-white">
      {/* Status bar */}
      <div className="mb-4 flex items-center gap-2 font-mono text-xs tracking-widest text-muted-foreground">
        <span className="text-primary">{'>'}</span>
        {isLoading ? 'LOADING...' : profileData ? 'PROFILE LOADED' : 'NOT FOUND'}
        <span className="mx-2 text-primary">{'//'}</span>
        {isLoading ? '...' : `@${username.toUpperCase()}`}
      </div>

      {/* Heading block */}
      <div className="flex flex-col justify-center">
        <h1 className="font-mono font-bold text-[15vw] leading-[0.85] tracking-tighter text-foreground lg:text-[9rem] xl:text-[11rem]">
          {isLoading ? (
            <span className="animate-pulse text-muted-foreground">...</span>
          ) : profileData ? (
            <>
              {username.toUpperCase().split(' ').slice(0, 2).map((word, i) => (
                <span key={i}>
                  {i === 0 ? word : (
                    <>
                      <br />
                      <span className="text-transparent [-webkit-text-stroke:1px_var(--color-primary)] hover:text-primary transition-colors duration-300">
                        {word}
                      </span>
                    </>
                  )}
                </span>
              ))}
              {username.toUpperCase().split(' ').length <= 1 && (
                <>
                  <br />
                  <span className="text-transparent [-webkit-text-stroke:1px_var(--color-primary)] hover:text-primary transition-colors duration-300">
                    DEV.
                  </span>
                </>
              )}
            </>
          ) : (
            <>
              NOT
              <br />
              <span className="text-transparent [-webkit-text-stroke:1px_var(--color-primary)]">
                FOUND.
              </span>
            </>
          )}
        </h1>
        <p className="mt-8 max-w-xl font-sans text-lg text-muted-foreground lg:text-xl">
          {isLoading ? 'Loading profile data...' : profileData ? tagline : 'This profile does not exist or has not been set up yet.'}
        </p>
      </div>

      {/* Stats cards */}
      <nav className="my-6 sm:mt-12 flex flex-col gap-4 sm:flex-row sm:items-end">
        <StatCard
          index="01"
          label="PROJECTS"
          value={profileData?.projects?.length ?? 0}
          icon={ComputerTerminal01Icon}
        />
        <StatCard
          index="02"
          label="JAMS"
          value={profileData?.jams?.length ?? 0}
          icon={UserGroupIcon}
        />
        <StatCard
          index="03"
          label="SKILLS"
          value={profileData?.skills?.length ?? 0}
          icon={IdentityCardIcon}
        />
      </nav>
    </div>
  );
}
