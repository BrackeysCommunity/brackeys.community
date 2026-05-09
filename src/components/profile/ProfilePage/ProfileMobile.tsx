import { useState } from "react";

import { ProfileAbout } from "./ProfileAbout";
import { ProfileActivitySection } from "./ProfileActivity";
import { ProfileAvailabilitySection } from "./ProfileAvailability";
import { ProfileHero } from "./ProfileHero";
import { ProfileJamLogSection } from "./ProfileJamLog";
import { ProfileLinkedAccountsSection } from "./ProfileLinkedAccounts";
import { ProfileMobileTabs, type ProfileMobileTab } from "./ProfileMobileTabs";
import { ProfileProjectsSection } from "./ProfileProjects";
import { ProfileSkillsSection } from "./ProfileSkills";
import type { ProfileLayoutProps } from "./shared-types";

/**
 * Mobile layout: hero + stats stay above the fold, then a sticky
 * tab strip filters content into Overview / Projects / Jams /
 * Skills sub-views. The Overview tab is the catch-all that mirrors
 * the desktop right-rail (about → availability → linked → activity).
 */
export function ProfileMobile({ profile, isOwner, openEdit, queryKey }: ProfileLayoutProps) {
  const [tab, setTab] = useState<ProfileMobileTab>("overview");

  return (
    <div className="flex flex-col">
      {/* Above-the-fold hero — stays across tabs so the title context
          never disappears. The stat row is desktop-only; on touch
          mobile the same numbers surface inline within their owning
          sections (PROJECTS count beside §02, SKILLS [N] in the
          header, etc.) so we don't double up. */}
      <div className="flex flex-col gap-4 pb-5">
        <ProfileHero
          profile={profile}
          isOwner={isOwner}
          onEditProfile={() => openEdit(1)}
          compact
        />
      </div>

      <ProfileMobileTabs active={tab} onChange={setTab} />

      <div className="flex flex-col gap-6 pt-5">
        {tab === "overview" ? (
          <>
            <ProfileAbout
              bio={profile.bio}
              pinnedNote={profile.pinnedNote}
              isOwner={isOwner}
              onEdit={() => openEdit(2)}
              compact
            />
            <ProfileAvailabilitySection
              index="02"
              availability={profile.availability}
              isOwner={isOwner}
              onEdit={() => openEdit(3)}
            />
            <ProfileLinkedAccountsSection
              index="03"
              links={profile.links}
              isOwner={isOwner}
              onEdit={() => openEdit(4)}
              queryKey={queryKey}
            />
            <ProfileActivitySection
              index="04"
              profileId={profile.profileId}
              githubUsername={profile.githubUsername}
            />
          </>
        ) : null}

        {tab === "projects" ? (
          <ProfileProjectsSection
            index="01"
            projects={profile.projects}
            editableProjects={profile.editableProjects}
            isOwner={isOwner}
            queryKey={queryKey}
            layout="list"
          />
        ) : null}

        {tab === "jams" ? (
          <ProfileJamLogSection index="01" best={profile.jamLogBest} entries={profile.jamLog} />
        ) : null}

        {tab === "skills" ? (
          <ProfileSkillsSection
            index="01"
            skills={profile.skills}
            isOwner={isOwner}
            onEdit={() => openEdit(2)}
          />
        ) : null}
      </div>
    </div>
  );
}
