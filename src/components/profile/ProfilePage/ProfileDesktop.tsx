import { ProfileAbout } from "./ProfileAbout";
import { ProfileActivitySection } from "./ProfileActivity";
import { ProfileAvailabilitySection } from "./ProfileAvailability";
import { ProfileHero } from "./ProfileHero";
import { ProfileJamLogSection } from "./ProfileJamLog";
import { ProfileLinkedAccountsSection } from "./ProfileLinkedAccounts";
import { ProfileProjectsSection } from "./ProfileProjects";
import { ProfileSkillsSection } from "./ProfileSkills";
import { ProfileStatsRow } from "./ProfileStats";
import type { ProfileLayoutProps } from "./shared-types";

/**
 * Desktop layout — two-column body under the hero:
 *
 * - Main column carries the page-level narrative content (ABOUT →
 *   PROJECTS → JAM LOG).
 * - Right rail carries the at-a-glance quick-look chrome
 *   (AVAILABILITY → LINKED → SKILLS → ACTIVITY).
 *
 * The hero spans full width above both columns.
 */
export function ProfileDesktop({ profile, isOwner, openEdit, queryKey }: ProfileLayoutProps) {
  return (
    <div className="flex flex-col gap-8">
      <ProfileHero profile={profile} isOwner={isOwner} onEditProfile={() => openEdit(1)} />
      <ProfileStatsRow stats={profile.stats} />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <div className="flex min-w-0 flex-col gap-8">
          <ProfileAbout
            bio={profile.bio}
            pinnedNote={profile.pinnedNote}
            isOwner={isOwner}
            onEdit={() => openEdit(2)}
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
          <ProfileAvailabilitySection
            index="A"
            availability={profile.availability}
            isOwner={isOwner}
            onEdit={() => openEdit(3)}
          />
          <ProfileSkillsSection
            index="B"
            skills={profile.skills}
            isOwner={isOwner}
            onEdit={() => openEdit(2)}
          />
          <ProfileLinkedAccountsSection
            index="C"
            links={profile.links}
            isOwner={isOwner}
            onEdit={() => openEdit(4)}
            queryKey={queryKey}
          />
          <ProfileActivitySection
            index="D"
            profileId={profile.profileId}
            githubUsername={profile.githubUsername}
          />
        </div>
      </div>
    </div>
  );
}
