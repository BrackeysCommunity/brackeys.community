import {
  Calendar03Icon,
  ComputerTerminal01Icon,
  IdentityCardIcon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons';
import { useQuery } from '@tanstack/react-query';
import { usePageSidebar } from '@/lib/hooks/use-page-layout';
import { orpc } from '@/orpc/client';
import { Route } from '@/routes/profile.$userId';
import { ProfileStatCard } from './ProfileStatCard';
import { ProfileViewSidebar } from './ProfileViewSidebar';

export function ProfileViewPage() {
  const { userId } = Route.useParams();

  const { data: profileData, isLoading } = useQuery({
    ...orpc.getProfile.queryOptions({ input: { userId } }),
    staleTime: 60 * 1000,
  });

  const profile = profileData?.profile;
  const username = profile?.discordUsername ?? 'UNKNOWN';
  const tagline = profile?.tagline || 'A member of the Brackeys community.';
  const bio = profile?.bio;

  const memberSince = profile?.createdAt
    ? new Date(profile.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : null;

  usePageSidebar(
    <ProfileViewSidebar profileData={profileData ?? null} isLoading={isLoading} />,
  );

  return (
    <>
      {/* Status bar */}
      <div className="mb-4 flex items-center gap-2 font-mono text-xs tracking-widest text-muted-foreground">
        <span className="text-primary">{'>'}</span>
        {isLoading ? 'LOADING...' : profileData ? 'PROFILE LOADED' : 'NOT FOUND'}
        <span className="mx-2 text-primary">{'//'}</span>
        {isLoading ? '...' : `@${username.toUpperCase()}`}
        {profileData?.isOwner && (
          <>
            <span className="mx-2 text-primary">{'//'}</span>
            <span className="text-brackeys-yellow/60">YOUR PROFILE</span>
          </>
        )}
      </div>

      {/* Heading block */}
      <div className="flex flex-col justify-center">
        <h1 className="font-mono font-bold text-[clamp(2.5rem,5.5vw,7rem)] leading-[0.85] tracking-tighter text-foreground">
          {isLoading ? (
            <span className="animate-pulse text-muted-foreground">...</span>
          ) : profileData ? (
            <>
              {username.toUpperCase().split(' ').slice(0, 2).map((word, i) => (
                <span key={word}>
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

        {bio && !isLoading && (
          <p className="mt-4 max-w-xl font-sans text-sm text-muted-foreground/60 leading-relaxed line-clamp-2">
            {bio}
          </p>
        )}
      </div>

      {/* Stats cards */}
      <nav className="my-6 sm:mt-12 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
        <ProfileStatCard
          index="01"
          label="PROJECTS"
          value={profileData?.projects?.length ?? 0}
          icon={ComputerTerminal01Icon}
        />
        <ProfileStatCard
          index="02"
          label="JAMS"
          value={profileData?.jams?.length ?? 0}
          icon={UserGroupIcon}
        />
        <ProfileStatCard
          index="03"
          label="SKILLS"
          value={profileData?.skills?.length ?? 0}
          icon={IdentityCardIcon}
        />
        {memberSince && (
          <ProfileStatCard
            index="04"
            label="MEMBER"
            value={memberSince.toUpperCase()}
            icon={Calendar03Icon}
          />
        )}
      </nav>
    </>
  );
}
