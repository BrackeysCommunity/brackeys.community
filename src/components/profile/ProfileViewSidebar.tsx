import { PencilEdit01Icon, Tick01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { AnimatePresence, motion } from 'framer-motion';
import { NotchedCard } from '@/components/ui/notched-card';
import { cn } from '@/lib/utils';
import { ProfileAvatar } from './ProfileAvatar';
import { ProfileBio } from './ProfileBio';
import { type CompletenessItem, ProfileCompletenessMini } from './ProfileCompleteness';
import { ProfileEditForm } from './ProfileEditForm';
import { ProfileJams } from './ProfileJams';
import { buildSocialLinks, ProfileLinks } from './ProfileLinks';
import { ProfileProjects } from './ProfileProjects';
import { ProfileRoles } from './ProfileRoles';
import { ProfileSkills } from './ProfileSkills';

interface ProfileData {
  profile: {
    id: string;
    discordId: string | null;
    discordUsername: string | null;
    avatarUrl: string | null;
    guildNickname: string | null;
    guildJoinedAt: Date | null;
    guildRoles: string[] | null;
    bio: string | null;
    tagline: string | null;
    githubUrl: string | null;
    twitterUrl: string | null;
    websiteUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  skills: Array<{ id: number; name: string; category: string | null }>;
  projects: Array<{
    id: number;
    title: string;
    description: string | null;
    url: string | null;
    imageUrl: string | null;
    tags: string[] | null;
    pinned: boolean | null;
    status: string;
  }>;
  jams: Array<{
    id: number;
    jamName: string;
    jamUrl: string | null;
    submissionTitle: string | null;
    submissionUrl: string | null;
    result: string | null;
    participatedAt: Date | null;
  }>;
  isOwner: boolean;
  urlStub: string | null;
  pendingSkillRequests?: Array<{ name: string }>;
}

interface ProfileViewSidebarProps {
  profileData: ProfileData | null;
  isLoading: boolean;
  profileQueryKey: readonly unknown[];
  isEditing: boolean;
  onToggleEdit: (editing: boolean) => void;
  completenessItems: CompletenessItem[];
  onCompletenessChange?: (items: CompletenessItem[]) => void;
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn('animate-pulse bg-muted/40 rounded-sm', className)} />;
}

function SidebarSection({
  label,
  count,
  children,
  className,
}: {
  label: string;
  count?: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('px-5 py-4 border-b border-muted/40', className)}>
      <h4 className="font-mono text-[10px] font-bold tracking-[0.15em] text-muted-foreground/50 uppercase mb-3">
        {label}
        {count !== undefined && (
          <span className="text-muted-foreground/25 ml-1.5">({count})</span>
        )}
      </h4>
      {children}
    </div>
  );
}

const fadeVariants = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
};
const fadeTransition = { duration: 0.2, ease: 'easeInOut' as const };

export function ProfileViewSidebar({ profileData, isLoading, profileQueryKey, isEditing, onToggleEdit, completenessItems, onCompletenessChange }: ProfileViewSidebarProps) {
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (!profileData) {
    return <NotFoundState />;
  }

  const { profile, skills, projects, jams, isOwner } = profileData;
  const username = profile.discordUsername ?? 'Unknown';
  const memberSince = profile.createdAt
    ? new Date(profile.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : null;

  const socialLinks = buildSocialLinks(profile);

  const handleShareProfile = () => {
    const slug = profileData.urlStub ?? profile.id;
    const url = `${window.location.origin}/profile/${slug}`;
    navigator.clipboard.writeText(url);
  };

  const header = (
    <div className="flex items-center justify-between">
      <span className="font-mono text-xs font-bold tracking-widest text-muted-foreground uppercase">
        @{username.toUpperCase()}
      </span>
      <div className="flex items-center gap-2">
        {isOwner && !isEditing && (
          <button
            type="button"
            onClick={() => onToggleEdit(true)}
            className="flex items-center gap-1 font-mono text-[10px] tracking-widest text-muted-foreground/40 uppercase hover:text-primary transition-colors"
          >
            <HugeiconsIcon icon={PencilEdit01Icon} size={10} />
            EDIT
          </button>
        )}
        {isOwner && isEditing && (
          <button
            type="button"
            onClick={() => onToggleEdit(false)}
            className="flex items-center gap-1 font-mono text-[10px] tracking-widest text-primary uppercase hover:text-primary/70 transition-colors"
          >
            <HugeiconsIcon icon={Tick01Icon} size={10} />
            DONE
          </button>
        )}
        {memberSince && !isEditing && (
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground/40 uppercase">
            SINCE {memberSince.toUpperCase()}
          </span>
        )}
      </div>
    </div>
  );

  const viewFooter = (
    <div className="px-4 py-3.5 flex items-center justify-center">
      <ProfileLinks
        links={socialLinks}
        discordId={profile.discordId}
        onShare={handleShareProfile}
      />
    </div>
  );

  const editFooter = (
    <div className="px-4 py-3 flex items-center justify-center">
      <span className="font-mono text-[10px] text-muted-foreground/40 tracking-widest uppercase">
        Auto-saving changes
      </span>
    </div>
  );

  return (
    <div className="flex h-full items-center justify-center p-6">
      <NotchedCard
        className="w-full h-full max-h-[800px]"
        header={header}
        footer={isEditing ? editFooter : viewFooter}
      >
        <AnimatePresence mode="wait">
          {isEditing ? (
            <motion.div
              key="edit"
              variants={fadeVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={fadeTransition}
            >
              <div className="sm:hidden">
                <ProfileCompletenessMini items={completenessItems} />
              </div>
              <ProfileEditForm
                profile={profile}
                skills={skills}
                projects={projects}
                jams={jams}
                pendingSkillRequests={profileData.pendingSkillRequests}
                urlStub={profileData.urlStub}
                profileQueryKey={profileQueryKey}
                onCompletenessChange={onCompletenessChange}
              />
            </motion.div>
          ) : (
            <motion.div
              key="view"
              variants={fadeVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={fadeTransition}
            >
              {/* Avatar */}
              <div className="flex flex-col items-center px-5 py-7 border-b border-muted/40">
                <ProfileAvatar
                  avatarUrl={profile.avatarUrl}
                  username={username}
                  tagline={profile.tagline}
                  size={96}
                />
              </div>

              {/* Roles */}
              {profile.guildRoles && profile.guildRoles.length > 0 && (
                <SidebarSection label="Roles">
                  <ProfileRoles roles={profile.guildRoles} />
                </SidebarSection>
              )}

              {/* Bio */}
              {profile.bio && (
                <SidebarSection label="Bio">
                  <ProfileBio bio={profile.bio} />
                </SidebarSection>
              )}

              {/* Skills */}
              {skills.length > 0 && (
                <SidebarSection label="Skills" count={skills.length}>
                  <ProfileSkills skills={skills} />
                </SidebarSection>
              )}

              {/* Projects */}
              {projects.length > 0 && (
                <SidebarSection label="Projects" count={projects.length}>
                  <ProfileProjects projects={projects} />
                </SidebarSection>
              )}

              {/* Jams */}
              {jams.length > 0 && (
                <SidebarSection label="Jam History" count={jams.length} className="border-b-0">
                  <ProfileJams jams={jams} />
                </SidebarSection>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </NotchedCard>

    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <NotchedCard
        className="w-full h-full max-h-[800px]"
        header={
          <div className="flex items-center justify-between">
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="h-3 w-16" />
          </div>
        }
      >
        <div className="flex flex-col items-center gap-3 px-5 py-6 border-b border-muted/60">
          <SkeletonBlock className="h-24 w-24 rounded-full" />
          <SkeletonBlock className="h-4 w-32" />
          <SkeletonBlock className="h-3 w-44" />
        </div>

        <div className="px-5 py-4 border-b border-muted/60 space-y-2">
          <SkeletonBlock className="h-2.5 w-12" />
          <div className="flex gap-1.5">
            <SkeletonBlock className="h-5 w-16" />
            <SkeletonBlock className="h-5 w-20" />
          </div>
        </div>

        <div className="px-5 py-4 border-b border-muted/60 space-y-2">
          <SkeletonBlock className="h-2.5 w-8" />
          <SkeletonBlock className="h-3 w-full" />
          <SkeletonBlock className="h-3 w-3/4" />
          <SkeletonBlock className="h-3 w-1/2" />
        </div>

        <div className="px-5 py-4 space-y-2">
          <SkeletonBlock className="h-2.5 w-14" />
          <div className="flex flex-wrap gap-1.5">
            <SkeletonBlock className="h-5 w-16" />
            <SkeletonBlock className="h-5 w-20" />
            <SkeletonBlock className="h-5 w-14" />
            <SkeletonBlock className="h-5 w-18" />
          </div>
        </div>
      </NotchedCard>
    </div>
  );
}

function NotFoundState() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <NotchedCard className="w-full h-full max-h-[800px]" scrollable={false}>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
          <div className="w-16 h-16 rounded-full border-2 border-muted/40 flex items-center justify-center">
            <span className="font-mono text-2xl text-muted-foreground/30">?</span>
          </div>
          <div className="text-center space-y-1.5">
            <p className="font-mono text-sm font-bold tracking-widest text-destructive/80 uppercase">
              Profile Not Found
            </p>
            <p className="font-mono text-xs text-muted-foreground/50 max-w-[200px]">
              This user hasn&apos;t set up their profile yet, or the link may be incorrect.
            </p>
          </div>
        </div>
      </NotchedCard>
    </div>
  );
}
