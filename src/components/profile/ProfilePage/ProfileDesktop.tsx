import { motion } from "framer-motion";

import { PageStack } from "@/components/ui/page-motion";
import { fadeLeft, fadeUp } from "@/lib/motion";

import { ProfileAbout } from "./ProfileAbout";
import { ProfileActivitySection } from "./ProfileActivity";
import { ProfileAvailabilitySection } from "./ProfileAvailability";
import { ProfileCreditsSection } from "./ProfileCredits";
import { ProfileHero } from "./ProfileHero";
import { ProfileJamLogSection } from "./ProfileJamLog";
import { ProfileLinkedAccountsSection } from "./ProfileLinkedAccounts";
import { ProfileProjectsSection } from "./ProfileProjects";
import { ProfileSkillsSection } from "./ProfileSkills";
import { ProfileStandingSection } from "./ProfileStanding";
import { ProfileSyncBar } from "./ProfileSyncBar";
import { ProfileTeamsSection } from "./ProfileTeams";
import { ProfileWallSection } from "./ProfileWall";
import type { ProfileLayoutProps } from "./shared-types";

/**
 * Desktop layout — banner hero card up top, then a two-column body:
 *
 * - Main column: itch.io sync bar → ACTIVITY (the GitHub
 *   contribution snake, full column width) → SHIPPED WORK capsule
 *   grid → JAM LOG.
 * - Right rail: ABOUT → HIRE DETAILS → STANDING → SKILLS → LINKED
 *   (linked account management is owner-only; visitors see the
 *   accounts' *results* — the sync bar, the contribution graph —
 *   instead of the raw account list).
 */
export function ProfileDesktop({ profile, isOwner, openEdit, queryKey }: ProfileLayoutProps) {
  return (
    <PageStack className="flex flex-col gap-8">
      <motion.div variants={fadeUp}>
        <ProfileHero
          profile={profile}
          isOwner={isOwner}
          onEditProfile={() => openEdit(1)}
          queryKey={queryKey}
        />
      </motion.div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,2.4fr)_minmax(19rem,1fr)]">
        <motion.div variants={fadeUp} className="flex min-w-0 flex-col gap-8">
          <ProfileSyncBar itch={profile.itch} isOwner={isOwner} queryKey={queryKey} />
          <ProfileActivitySection
            index="01"
            profileId={profile.profileId}
            githubUsername={profile.githubUsername}
            isOwner={isOwner}
          />
          <ProfileProjectsSection
            index="02"
            projects={profile.projects}
            editableProjects={profile.editableProjects}
            isOwner={isOwner}
            queryKey={queryKey}
          />
          <ProfileJamLogSection index="03" best={profile.jamLogBest} entries={profile.jamLog} />
          <ProfileCreditsSection index="04" credits={profile.credits} />
        </motion.div>

        <motion.div variants={fadeLeft} className="flex flex-col gap-6">
          <ProfileAbout
            index="A"
            bio={profile.bio}
            pinnedNote={profile.pinnedNote}
            isOwner={isOwner}
            onEdit={() => openEdit(2)}
            compact
          />
          <ProfileAvailabilitySection
            index="B"
            availability={profile.availability}
            isOwner={isOwner}
            onEdit={() => openEdit(3)}
          />
          <ProfileStandingSection index="C" badges={profile.badges} stats={profile.stats} />
          <ProfileSkillsSection
            index="D"
            skills={profile.skills}
            isOwner={isOwner}
            onEdit={() => openEdit(2)}
          />
          <ProfileTeamsSection index="E" profileId={profile.profileId} />
          <ProfileLinkedAccountsSection
            index="F"
            links={profile.links}
            isOwner={isOwner}
            onEdit={() => openEdit(4)}
            queryKey={queryKey}
          />
        </motion.div>
      </div>

      <motion.div variants={fadeUp}>
        <ProfileWallSection
          index="05"
          profileId={profile.profileId}
          profileName={profile.handle}
          isOwner={isOwner}
          notesEnabled={profile.notesEnabled}
          queryKey={queryKey}
        />
      </motion.div>
    </PageStack>
  );
}
