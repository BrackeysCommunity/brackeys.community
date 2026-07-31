import { ProfileAbout } from "./ProfileAbout";
import { ProfileActivitySection } from "./ProfileActivity";
import { ProfileAvailabilitySection } from "./ProfileAvailability";
import { ProfileHero } from "./ProfileHero";
import { ProfileJamLogSection } from "./ProfileJamLog";
import { ProfileLinkedAccountsSection } from "./ProfileLinkedAccounts";
import { ProfileProjectsSection } from "./ProfileProjects";
import { ProfileSkillsSection } from "./ProfileSkills";
import { ProfileStandingSection } from "./ProfileStanding";
import { ProfileSyncBar } from "./ProfileSyncBar";
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
    <div className="flex flex-col gap-8">
      <ProfileHero
        profile={profile}
        isOwner={isOwner}
        onEditProfile={() => openEdit(1)}
        queryKey={queryKey}
      />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,2.4fr)_minmax(19rem,1fr)]">
        <div className="flex min-w-0 flex-col gap-8">
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
        </div>

        <div className="flex flex-col gap-6">
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
          <ProfileLinkedAccountsSection
            index="E"
            links={profile.links}
            isOwner={isOwner}
            onEdit={() => openEdit(4)}
            queryKey={queryKey}
          />
        </div>
      </div>
    </div>
  );
}
