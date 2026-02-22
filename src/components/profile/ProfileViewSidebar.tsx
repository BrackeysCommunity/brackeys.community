import { Github01Icon, GlobalIcon, Link01Icon, Share01Icon, TwitterIcon } from '@hugeicons/core-free-icons';
import type { IconSvgElement } from '@hugeicons/react';
import { HugeiconsIcon } from '@hugeicons/react';
import { motion } from 'framer-motion';
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react';
import { buttonVariants } from '@/components/ui/button';
import { useMagnetic } from '@/lib/hooks/use-cursor';
import { cn } from '@/lib/utils';

const NOTCH_SIZE = 22;
const notchClip = `polygon(0 0, calc(100% - ${NOTCH_SIZE}px) 0, 100% ${NOTCH_SIZE}px, 100% 100%, 0 100%)`;
const notchClipInner = `polygon(0 0, calc(100% - ${NOTCH_SIZE - 2}px) 0, 100% ${NOTCH_SIZE - 2}px, 100% 100%, 0 100%)`;
const springTransition = { type: 'spring', stiffness: 1000, damping: 30, mass: 0.1 } as const;

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
}

interface ProfileViewSidebarProps {
  profileData: ProfileData | null;
  isLoading: boolean;
}

function MagneticFooterLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { ref, position } = useMagnetic(0.25);
  return (
    <motion.div
      ref={ref as React.RefObject<HTMLDivElement>}
      data-magnetic
      animate={{ x: position.x, y: position.y }}
      transition={springTransition}
      className="flex-1"
    >
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {children}
      </a>
    </motion.div>
  );
}

function MagneticFooterButton({
  onClick,
  children,
  className,
}: {
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const { ref, position } = useMagnetic(0.25);
  return (
    <motion.div
      ref={ref as React.RefObject<HTMLDivElement>}
      data-magnetic
      animate={{ x: position.x, y: position.y }}
      transition={springTransition}
      className="flex-1"
    >
      <button type="button" onClick={onClick} className={className}>
        {children}
      </button>
    </motion.div>
  );
}

function SocialLink({ href, icon, label }: { href: string; icon: IconSvgElement; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 font-mono text-xs tracking-widest text-muted-foreground hover:text-primary transition-colors"
      title={label}
    >
      <HugeiconsIcon icon={icon} size={14} />
      <span className="uppercase truncate">{label}</span>
    </a>
  );
}

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn('animate-pulse bg-muted/40 rounded-sm', className)} />;
}

export function ProfileViewSidebar({ profileData, isLoading }: ProfileViewSidebarProps) {
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full h-full bg-muted/60" style={{ clipPath: notchClip, padding: '2px' }}>
          <div className="flex flex-col w-full h-full bg-background/90 backdrop-blur-md relative" style={{ clipPath: notchClipInner }}>
            <div className="flex items-center justify-between border-b border-muted/60 bg-card/40 px-4 py-2.5">
              <SkeletonBlock className="h-3 w-24" />
              <SkeletonBlock className="h-3 w-16" />
            </div>
            <div className="flex flex-col items-center gap-3 px-5 py-6 border-b border-muted/60">
              <SkeletonBlock className="h-20 w-20 rounded-full" />
              <SkeletonBlock className="h-4 w-32" />
            </div>
            <div className="p-5 space-y-4">
              <SkeletonBlock className="h-3 w-full" />
              <SkeletonBlock className="h-3 w-3/4" />
              <SkeletonBlock className="h-3 w-1/2" />
              <div className="flex gap-2 mt-4">
                <SkeletonBlock className="h-5 w-16" />
                <SkeletonBlock className="h-5 w-20" />
                <SkeletonBlock className="h-5 w-14" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!profileData) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full h-full bg-muted/60" style={{ clipPath: notchClip, padding: '2px' }}>
          <div className="flex flex-col w-full h-full bg-background/90 backdrop-blur-md relative items-center justify-center" style={{ clipPath: notchClipInner }}>
            <span className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-brackeys-yellow/50 pointer-events-none" />
            <span className="absolute top-0 left-0 w-2 h-2 border-t border-l border-brackeys-yellow/50 pointer-events-none" />
            <svg
              aria-hidden="true"
              className="absolute top-0 right-0 pointer-events-none text-brackeys-yellow/40"
              width={NOTCH_SIZE + 2}
              height={NOTCH_SIZE + 2}
              viewBox={`0 0 ${NOTCH_SIZE + 2} ${NOTCH_SIZE + 2}`}
              fill="none"
            >
              <line x1="0" y1="1" x2={NOTCH_SIZE + 1} y2={NOTCH_SIZE + 2} stroke="currentColor" strokeWidth="1" />
            </svg>
            <p className="font-mono text-sm font-bold tracking-widest text-destructive uppercase">PROFILE NOT FOUND</p>
            <p className="font-mono text-xs text-muted-foreground mt-2">ERR_404 // NO DATA</p>
          </div>
        </div>
      </div>
    );
  }

  const { profile, skills, projects, jams } = profileData;
  const username = profile.discordUsername ?? 'Unknown';
  const memberSince = profile.createdAt
    ? new Date(profile.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : null;

  const socialLinks: { href: string; icon: IconSvgElement; label: string }[] = [];
  if (profile.githubUrl) socialLinks.push({ href: profile.githubUrl, icon: Github01Icon, label: 'GitHub' });
  if (profile.twitterUrl) socialLinks.push({ href: profile.twitterUrl, icon: TwitterIcon, label: 'Twitter' });
  if (profile.websiteUrl) socialLinks.push({ href: profile.websiteUrl, icon: GlobalIcon, label: 'Website' });

  const handleShareProfile = () => {
    const slug = profileData.urlStub ?? profile.id;
    const url = `${window.location.origin}/profile/${slug}`;
    navigator.clipboard.writeText(url);
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div
        className="w-full h-full bg-muted/60"
        style={{ clipPath: notchClip, padding: '2px' }}
      >
        <div
          className="flex flex-col w-full h-full bg-background/90 backdrop-blur-md relative"
          style={{ clipPath: notchClipInner }}
        >
          {/* Corner decorators */}
          <span className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-brackeys-yellow/50 pointer-events-none" />
          <span className="absolute top-0 left-0 w-2 h-2 border-t border-l border-brackeys-yellow/50 pointer-events-none" />
          <svg
            aria-hidden="true"
            className="absolute top-0 right-0 pointer-events-none text-brackeys-yellow/40"
            width={NOTCH_SIZE + 2}
            height={NOTCH_SIZE + 2}
            viewBox={`0 0 ${NOTCH_SIZE + 2} ${NOTCH_SIZE + 2}`}
            fill="none"
          >
            <line x1="0" y1="1" x2={NOTCH_SIZE + 1} y2={NOTCH_SIZE + 2} stroke="currentColor" strokeWidth="1" />
          </svg>

          {/* Card header */}
          <div className="flex items-center justify-between border-b border-muted/60 bg-card/40 px-4 py-2.5">
            <span className="font-mono text-xs font-bold tracking-widest text-muted-foreground uppercase">
              @{username.toUpperCase()}
            </span>
            {memberSince && (
              <span className="font-mono text-[10px] tracking-widest text-muted-foreground/60 uppercase">
                SINCE {memberSince.toUpperCase()}
              </span>
            )}
          </div>

          {/* Scrollable content */}
          <OverlayScrollbarsComponent
            className="flex-1 overflow-hidden"
            options={{ scrollbars: { autoHide: 'scroll' } }}
            defer
          >
            {/* Avatar section */}
            <div className="flex flex-col items-center gap-3 px-5 py-6 border-b border-muted/60">
              {profile.avatarUrl ? (
                <img
                  src={profile.avatarUrl}
                  alt={username}
                  className="h-20 w-20 rounded-full border-2 border-muted grayscale transition-all duration-300 hover:grayscale-0 hover:border-primary"
                />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-muted bg-card/60 font-mono text-2xl font-bold text-muted-foreground">
                  {username.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="text-center">
                <p className="font-mono text-sm font-bold tracking-widest text-foreground">{username}</p>
                {profile.tagline && (
                  <p className="font-mono text-xs text-muted-foreground mt-1">{profile.tagline}</p>
                )}
              </div>
            </div>

            {/* Roles */}
            {profile.guildRoles && profile.guildRoles.length > 0 && (
              <div className="px-5 py-4 border-b border-muted/60">
                <h4 className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase mb-2">ROLES</h4>
                <div className="flex flex-wrap gap-1.5">
                  {profile.guildRoles.map((role) => (
                    <span
                      key={role}
                      className="inline-flex items-center px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest uppercase border border-[#5865f2]/40 text-[#5865f2] bg-[#5865f2]/10"
                    >
                      {role}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Bio */}
            {profile.bio && (
              <div className="px-5 py-4 border-b border-muted/60">
                <h4 className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase mb-2">BIO</h4>
                <p className="font-sans text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{profile.bio}</p>
              </div>
            )}

            {/* Skills */}
            {skills.length > 0 && (
              <div className="px-5 py-4 border-b border-muted/60">
                <h4 className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase mb-2">
                  SKILLS ({skills.length})
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {skills.map((skill) => (
                    <span
                      key={skill.id}
                      className="inline-flex items-center px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest uppercase border border-brackeys-yellow/40 text-brackeys-yellow bg-brackeys-yellow/10"
                    >
                      {skill.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Social links */}
            {socialLinks.length > 0 && (
              <div className="px-5 py-4 border-b border-muted/60">
                <h4 className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase mb-2">LINKS</h4>
                <div className="flex flex-col gap-2">
                  {socialLinks.map((link) => (
                    <SocialLink key={link.label} {...link} />
                  ))}
                </div>
              </div>
            )}

            {/* Projects */}
            {projects.length > 0 && (
              <div className="px-5 py-4 border-b border-muted/60">
                <h4 className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase mb-2">
                  PROJECTS ({projects.length})
                </h4>
                <div className="flex flex-col gap-3">
                  {projects.map((project) => (
                    <div
                      key={project.id}
                      className="border border-muted/60 bg-card/40 p-3"
                    >
                      {project.imageUrl && (
                        <img src={project.imageUrl} alt={project.title} className="w-full h-24 object-cover border border-muted/20 mb-2" />
                      )}
                      <div className="flex items-start justify-between gap-2">
                        <h5 className="font-mono text-xs font-bold tracking-widest text-foreground uppercase">{project.title}</h5>
                        {project.url && (
                          <a
                            href={project.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-primary transition-colors shrink-0"
                          >
                            <HugeiconsIcon icon={Link01Icon} size={12} />
                          </a>
                        )}
                      </div>
                      {project.description && (
                        <p className="font-sans text-xs text-muted-foreground mt-1 line-clamp-2">{project.description}</p>
                      )}
                      {project.tags && project.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {project.tags.map((tag) => (
                            <span
                              key={tag}
                              className="px-1.5 py-0.5 font-mono text-[9px] tracking-widest text-muted-foreground/60 border border-muted/40 uppercase"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Jam history */}
            {jams.length > 0 && (
              <div className="px-5 py-4">
                <h4 className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase mb-2">
                  JAM HISTORY ({jams.length})
                </h4>
                <div className="flex flex-col gap-2">
                  {jams.map((jam) => (
                    <div
                      key={jam.id}
                      className="flex items-start gap-3 border-l-2 border-muted/60 pl-3 py-1"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-xs font-bold tracking-widest text-foreground uppercase truncate">
                          {jam.jamUrl ? (
                            <a href={jam.jamUrl} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
                              {jam.jamName}
                            </a>
                          ) : (
                            jam.jamName
                          )}
                        </p>
                        {jam.submissionTitle && (
                          <p className="font-mono text-[10px] text-muted-foreground truncate mt-0.5">
                            {jam.submissionUrl ? (
                              <a href={jam.submissionUrl} target="_blank" rel="noopener noreferrer" className="hover:text-primary transition-colors">
                                {jam.submissionTitle}
                              </a>
                            ) : (
                              jam.submissionTitle
                            )}
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-0.5">
                          {jam.result && (
                            <span className="font-mono text-[10px] font-bold tracking-widest text-brackeys-yellow uppercase">{jam.result}</span>
                          )}
                          {jam.participatedAt && (
                            <span className="font-mono text-[9px] text-muted-foreground/50">
                              {new Date(jam.participatedAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </OverlayScrollbarsComponent>

          {/* Footer */}
          <div className="border-t border-muted/60 bg-card/30 px-6 py-4 flex gap-8">
            {profile.discordId && (
              <MagneticFooterLink
                href={`https://discord.com/users/${profile.discordId}`}
                className={cn(
                  buttonVariants({ variant: 'outline', size: 'sm' }),
                  'w-full border-[#5865f2]/40 text-[#5865f2] hover:bg-[#5865f2]/10 hover:border-[#5865f2] font-mono text-[10px] font-bold tracking-widest uppercase justify-between',
                )}
              >
                Discord
                <HugeiconsIcon icon={Share01Icon} size={13} />
              </MagneticFooterLink>
            )}

            <MagneticFooterButton
              onClick={handleShareProfile}
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'w-full border-brackeys-yellow/40 text-brackeys-yellow hover:bg-brackeys-yellow/10 hover:border-brackeys-yellow font-mono text-[10px] font-bold tracking-widest uppercase justify-between',
              )}
            >
              Share Profile
              <HugeiconsIcon icon={Share01Icon} size={13} />
            </MagneticFooterButton>
          </div>
        </div>
      </div>
    </div>
  );
}
