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
import { ProfileStandingSection } from "./ProfileStanding";
import { ProfileSyncBar } from "./ProfileSyncBar";
import type { ProfileLayoutProps } from "./shared-types";

/**
 * Mobile layout: banner hero card above the fold, then a sticky tab
 * strip filters content into Overview / Projects / Jams / Skills
 * sub-views. The Overview tab mirrors the desktop right-rail (about
 * → hire details → standing → linked → activity snake).
 */
export function ProfileMobile({ profile, isOwner, openEdit, queryKey }: ProfileLayoutProps) {
  const [tab, setTab] = useState<ProfileMobileTab>("overview");

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-4 pb-5">
        <ProfileHero
          profile={profile}
          isOwner={isOwner}
          onEditProfile={() => openEdit(1)}
          queryKey={queryKey}
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
            <ProfileStandingSection index="03" badges={profile.badges} stats={profile.stats} />
            <ProfileLinkedAccountsSection
              index="04"
              links={profile.links}
              isOwner={isOwner}
              onEdit={() => openEdit(4)}
              queryKey={queryKey}
            />
          </>
        ) : null}

        {tab === "projects" ? (
          <>
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
              layout="list"
            />
          </>
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
