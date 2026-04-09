import {
  Calendar03Icon,
  ComputerTerminal01Icon,
  IdentityCardIcon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useState } from "react";

import { usePageSidebar } from "@/lib/hooks/use-page-layout";
import { orpc } from "@/orpc/client";
import { Route } from "@/routes/profile.$userId";

import {
  buildCompletenessItems,
  type CompletenessItem,
  ProfileCompletenessCard,
} from "./ProfileCompleteness";
import { ProfileStatCard } from "./ProfileStatCard";
import { ProfileViewSidebar } from "./ProfileViewSidebar";

const swapVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -12 },
};
const swapTransition = { duration: 0.25, ease: "easeInOut" as const };

export function ProfileViewPage() {
  const { userId } = Route.useParams();
  const [isEditing, setIsEditing] = useState(false);
  const [localCompleteness, setLocalCompleteness] = useState<CompletenessItem[] | null>(null);

  const queryOptions = orpc.getProfile.queryOptions({ input: { userId } });
  const { data: profileData, isLoading } = useQuery({
    ...queryOptions,
    staleTime: 60 * 1000,
  });

  const profile = profileData?.profile;
  const username = profile?.discordUsername ?? "UNKNOWN";
  const tagline = profile?.tagline || "A member of the Brackeys community.";
  const bio = profile?.bio;

  const memberSince = profile?.createdAt
    ? new Date(profile.createdAt).toLocaleDateString(undefined, {
        month: "short",
        year: "numeric",
      })
    : null;

  const linkedGithubUrl =
    profileData?.linkedAccounts?.find((account) => account.provider === "github")
      ?.providerProfileUrl ?? null;
  const linkedItchIoUrl =
    profileData?.linkedAccounts?.find((account) => account.provider === "itchio")
      ?.providerProfileUrl ?? null;

  const serverCompleteness = profileData
    ? buildCompletenessItems({
        tagline: profile?.tagline ?? null,
        bio: profile?.bio ?? null,
        skills: profileData.skills,
        pendingSkillCount: profileData.pendingSkillRequests?.length ?? 0,
        githubUrl: linkedGithubUrl ?? profile?.githubUrl ?? null,
        twitterUrl: profile?.twitterUrl ?? null,
        websiteUrl: profile?.websiteUrl ?? null,
        itchIoUrl: linkedItchIoUrl,
        projects: profileData.projects,
      })
    : [];

  const nonJamProjectCount =
    profileData?.projects?.filter((project) => project.type !== "jam").length ?? 0;
  const jamProjectCount =
    profileData?.projects?.filter((project) => project.type === "jam").length ?? 0;

  const completenessItems = isEditing && localCompleteness ? localCompleteness : serverCompleteness;

  const handleCompletenessChange = useCallback((items: CompletenessItem[]) => {
    setLocalCompleteness(items);
  }, []);

  usePageSidebar(
    <ProfileViewSidebar
      profileData={profileData ?? null}
      isLoading={isLoading}
      profileQueryKey={queryOptions.queryKey}
      isEditing={isEditing}
      onToggleEdit={setIsEditing}
      completenessItems={completenessItems}
      onCompletenessChange={handleCompletenessChange}
    />,
  );

  return (
    <>
      {/* Status bar */}
      <div className="mb-4 flex items-center gap-2 font-mono text-xs tracking-widest text-muted-foreground">
        <span className="text-primary">{">"}</span>
        {isLoading ? "LOADING..." : profileData ? "PROFILE LOADED" : "NOT FOUND"}
        <span className="mx-2 text-primary">{"//"}</span>
        {isLoading ? "..." : `@${username.toUpperCase()}`}
        {profileData?.isOwner && (
          <>
            <span className="mx-2 text-primary">{"//"}</span>
            <span className="text-brackeys-yellow/60">
              {isEditing ? "EDITING" : "YOUR PROFILE"}
            </span>
          </>
        )}
      </div>

      {/* Heading block */}
      <div className="flex flex-col justify-center">
        <h1 className="font-mono text-[clamp(2.5rem,5.5vw,7rem)] leading-[0.85] font-bold tracking-tighter text-foreground">
          {isLoading ? (
            <span className="animate-pulse text-muted-foreground">...</span>
          ) : profileData ? (
            <>
              {username
                .toUpperCase()
                .split(" ")
                .slice(0, 2)
                .map((word, i) => (
                  <span key={word}>
                    {i === 0 ? (
                      word
                    ) : (
                      <>
                        <br />
                        <span className="text-transparent transition-colors duration-300 [-webkit-text-stroke:1px_var(--color-primary)] hover:text-primary">
                          {word}
                        </span>
                      </>
                    )}
                  </span>
                ))}
              {username.toUpperCase().split(" ").length <= 1 && (
                <>
                  <br />
                  <span className="text-transparent transition-colors duration-300 [-webkit-text-stroke:1px_var(--color-primary)] hover:text-primary">
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
          {isLoading
            ? "Loading profile data..."
            : profileData
              ? tagline
              : "This profile does not exist or has not been set up yet."}
        </p>

        {bio && !isLoading && !isEditing && (
          <p className="mt-4 line-clamp-2 max-w-xl font-sans text-sm leading-relaxed text-muted-foreground/60">
            {bio}
          </p>
        )}
      </div>

      {/* Cards area: stat cards (view mode) or completeness cards (edit mode) */}
      <AnimatePresence mode="wait">
        {isEditing && profileData?.isOwner ? (
          <motion.div
            key="completeness"
            variants={swapVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={swapTransition}
            className="hidden sm:block"
          >
            <ProfileCompletenessCard items={completenessItems} />
          </motion.div>
        ) : (
          <motion.div
            key="stats"
            variants={swapVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={swapTransition}
          >
            <nav className="my-6 flex flex-col gap-4 sm:mt-12 sm:flex-row sm:flex-wrap sm:items-end">
              <ProfileStatCard
                index="01"
                label="PROJECTS"
                value={nonJamProjectCount}
                icon={ComputerTerminal01Icon}
              />
              <ProfileStatCard
                index="02"
                label="JAMS"
                value={jamProjectCount}
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
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
