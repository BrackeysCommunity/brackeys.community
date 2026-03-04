import { Github01Icon, Globe02Icon, NewTwitterIcon, GameController01Icon, Link01Icon, Delete02Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CharCount } from '@/components/ui/form-primitives';
import { env } from '@/env';
import { useMagnetic } from '@/lib/hooks/use-cursor';
import { cn } from '@/lib/utils';
import { client } from '@/orpc/client';
import { buildCompletenessItems, type CompletenessItem } from './ProfileCompleteness';
import { AddJamForm, EditableJamEntry } from './ProfileJamEditor';
import { AddProjectForm, EditableProjectCard } from './ProfileProjectEditor';
import { PendingSkillTag, SkillAutocomplete, SkillTag } from './ProfileSkillEditor';

interface ProfileEditFormProps {
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
  pendingSkillRequests?: Array<{ name: string }>;
  linkedAccounts?: Array<{
    id: number;
    provider: string;
    providerUserId: string;
    providerUsername: string | null;
    providerAvatarUrl: string | null;
    providerProfileUrl: string | null;
    linkedAt: Date;
  }>;
  urlStub: string | null;
  profileQueryKey: readonly unknown[];
  onCompletenessChange?: (items: CompletenessItem[]) => void;
}

function EditSection({
  label,
  complete,
  children,
  className,
}: {
  label: string;
  complete?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('group/section', className)}>
      <div className="px-4 py-2 border-b border-muted/30 flex items-center justify-between">
        <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase">
          {label}
        </span>
        {complete !== undefined && (
          <span
            className={cn(
              'w-1.5 h-1.5 rounded-full transition-colors',
              complete ? 'bg-green-500' : 'bg-muted/40',
            )}
            title={complete ? 'Complete' : 'Incomplete'}
          />
        )}
      </div>
      {children}
    </div>
  );
}

const fieldSpring = { type: 'spring', stiffness: 1000, damping: 30, mass: 0.1 } as const;

function MagneticField({ children, className, bounce = 0.01 }: { children: React.ReactNode; className?: string, bounce?: number }) {
  const { ref, position } = useMagnetic(0);
  return (
    <motion.div
      ref={ref as React.RefObject<HTMLDivElement>}
      data-magnetic
      data-cursor-no-drift
      data-cursor-bounce={bounce}
      animate={{ x: position.x, y: position.y }}
      transition={fieldSpring}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function LinkInput({
  icon,
  value,
  onChange,
  placeholder,
}: {
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <MagneticField>
      <div className="flex items-center gap-2 bg-muted/5 border border-muted/15 px-2.5 py-1.5 hover:border-muted/40 focus-within:border-primary/40 focus-within:bg-muted/10 transition-all group/link">
        <span className="text-muted-foreground/30 group-focus-within/link:text-primary/50 transition-colors shrink-0">
          {icon}
        </span>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="flex-1 bg-transparent font-mono text-xs text-foreground placeholder-muted-foreground/20 outline-none"
        />
        {value && (
          <span className="w-1.5 h-1.5 rounded-full bg-green-500/60 shrink-0" />
        )}
      </div>
    </MagneticField>
  );
}

export function ProfileEditForm({
  profile,
  skills,
  projects,
  jams,
  pendingSkillRequests,
  linkedAccounts,
  urlStub: initialUrlStub,
  profileQueryKey,
  onCompletenessChange,
}: ProfileEditFormProps) {
  const queryClient = useQueryClient();

  const serverPendingNames = useMemo(
    () => (pendingSkillRequests ?? []).map((r) => r.name),
    [pendingSkillRequests],
  );
  const [localPendingRequests, setLocalPendingRequests] = useState<string[]>([]);
  const pendingRequests = useMemo(() => {
    const all = new Set([...serverPendingNames, ...localPendingRequests]);
    return Array.from(all);
  }, [serverPendingNames, localPendingRequests]);

  const [tagline, setTagline] = useState(profile.tagline ?? '');
  const [bio, setBio] = useState(profile.bio ?? '');
  const [githubUrl, setGithubUrl] = useState(profile.githubUrl ?? '');
  const [twitterUrl, setTwitterUrl] = useState(profile.twitterUrl ?? '');
  const [websiteUrl, setWebsiteUrl] = useState(profile.websiteUrl ?? '');

  useEffect(() => {
    onCompletenessChange?.(buildCompletenessItems({
      tagline, bio, skills,
      pendingSkillCount: pendingRequests.length,
      githubUrl, twitterUrl, websiteUrl, projects, jams,
    }));
  }, [tagline, bio, skills, pendingRequests.length, githubUrl, twitterUrl, websiteUrl, projects, jams, onCompletenessChange]);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const updateMutation = useMutation({
    mutationFn: (input: Parameters<typeof client.updateProfile>[0]) =>
      client.updateProfile(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileQueryKey }),
  });

  const debouncedSave = useCallback(
    (fields: Record<string, string | undefined>) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        updateMutation.mutate(fields);
      }, 800);
    },
    [updateMutation],
  );

  const handleFieldChange = (field: string, value: string, setter: (v: string) => void) => {
    setter(value);
    debouncedSave({ [field]: value });
  };

  const addUserSkillMutation = useMutation({
    mutationFn: (skillId: number) => client.addUserSkill({ skillId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileQueryKey });
      toast.success('Skill added');
    },
  });

  const [removedSkillIds, setRemovedSkillIds] = useState<Set<number>>(new Set());
  const removeUserSkillMutation = useMutation({
    mutationFn: (userSkillId: number) => client.removeUserSkill({ userSkillId }),
    onMutate: (userSkillId) => {
      setRemovedSkillIds((prev) => new Set(prev).add(userSkillId));
    },
    onSuccess: async (_data, userSkillId) => {
      await queryClient.invalidateQueries({ queryKey: profileQueryKey });
      setRemovedSkillIds((prev) => { const next = new Set(prev); next.delete(userSkillId); return next; });
      toast.success('Skill removed');
    },
    onError: (_err, userSkillId) => {
      setRemovedSkillIds((prev) => { const next = new Set(prev); next.delete(userSkillId); return next; });
      toast.error('Failed to remove skill');
    },
  });

  const requestSkillMutation = useMutation({
    mutationFn: (name: string) => client.requestSkill({ name }),
    onSuccess: (_data, name) => {
      setLocalPendingRequests((prev) => [...prev, name]);
      toast.success('Skill requested');
    },
  });

  const [removedPendingNames, setRemovedPendingNames] = useState<Set<string>>(new Set());
  const cancelSkillRequestMutation = useMutation({
    mutationFn: (name: string) => client.cancelSkillRequest({ name }),
    onMutate: (name) => {
      setRemovedPendingNames((prev) => new Set(prev).add(name));
      setLocalPendingRequests((prev) => prev.filter((n) => n !== name));
    },
    onSuccess: async (_data, name) => {
      await queryClient.invalidateQueries({ queryKey: profileQueryKey });
      setRemovedPendingNames((prev) => { const next = new Set(prev); next.delete(name); return next; });
      toast.success('Skill request cancelled');
    },
    onError: (_err, name) => {
      setRemovedPendingNames((prev) => { const next = new Set(prev); next.delete(name); return next; });
      toast.error('Failed to cancel skill request');
    },
  });

  const addProjectMutation = useMutation({
    mutationFn: (data: { title: string; description?: string; url?: string; imageUrl?: string }) =>
      client.addProject(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileQueryKey });
      toast.success('Project added');
    },
  });

  const [removedProjectIds, setRemovedProjectIds] = useState<Set<number>>(new Set());
  const removeProjectMutation = useMutation({
    mutationFn: (projectId: number) => client.removeProject({ projectId }),
    onMutate: (projectId) => {
      setRemovedProjectIds((prev) => new Set(prev).add(projectId));
    },
    onSuccess: async (_data, projectId) => {
      await queryClient.invalidateQueries({ queryKey: profileQueryKey });
      setRemovedProjectIds((prev) => { const next = new Set(prev); next.delete(projectId); return next; });
      toast.success('Project removed');
    },
    onError: (_err, projectId) => {
      setRemovedProjectIds((prev) => { const next = new Set(prev); next.delete(projectId); return next; });
      toast.error('Failed to remove project');
    },
  });

  const addJamMutation = useMutation({
    mutationFn: (data: { jamName: string; submissionTitle?: string; submissionUrl?: string; result?: string }) =>
      client.addJamParticipation(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileQueryKey });
      toast.success('Jam entry added');
    },
  });

  const [removedJamIds, setRemovedJamIds] = useState<Set<number>>(new Set());
  const removeJamMutation = useMutation({
    mutationFn: (jamId: number) => client.removeJamParticipation({ jamId }),
    onMutate: (jamId) => {
      setRemovedJamIds((prev) => new Set(prev).add(jamId));
    },
    onSuccess: async (_data, jamId) => {
      await queryClient.invalidateQueries({ queryKey: profileQueryKey });
      setRemovedJamIds((prev) => { const next = new Set(prev); next.delete(jamId); return next; });
      toast.success('Jam entry removed');
    },
    onError: (_err, jamId) => {
      setRemovedJamIds((prev) => { const next = new Set(prev); next.delete(jamId); return next; });
      toast.error('Failed to remove jam entry');
    },
  });

  const unlinkItchIoMutation = useMutation({
    mutationFn: () => client.unlinkItchIo({}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileQueryKey });
      toast.success('itch.io account unlinked');
    },
    onError: () => {
      toast.error('Failed to unlink itch.io account');
    },
  });

  const importItchIoGamesMutation = useMutation({
    mutationFn: () => client.importItchIoGames({}),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: profileQueryKey });
      if (data.imported > 0) {
        toast.success(`Imported ${data.imported} game${data.imported === 1 ? '' : 's'} from itch.io`);
      } else {
        toast.info('No new games to import');
      }
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to import games from itch.io');
    },
  });

  const itchIoAccount = linkedAccounts?.find((a) => a.provider === 'itchio');

  const handleLinkItchIo = () => {
    const clientId = env.VITE_ITCHIO_CLIENT_ID;
    if (!clientId) {
      toast.error('itch.io integration is not configured');
      return;
    }
    const redirectUri = `${window.location.origin}/oauth/itchio/callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      scope: 'profile:me profile:games',
      response_type: 'token',
      redirect_uri: redirectUri,
    });
    window.location.href = `https://itch.io/user/oauth?${params.toString()}`;
  };

  const visibleSkills = skills.filter((s) => !removedSkillIds.has(s.id));
  const visiblePendingRequests = pendingRequests.filter((n) => !removedPendingNames.has(n));
  const visibleProjects = projects.filter((p) => !removedProjectIds.has(p.id));
  const visibleJams = jams.filter((j) => !removedJamIds.has(j.id));

  const [urlStub, setUrlStub] = useState(initialUrlStub ?? '');
  const [urlStubError, setUrlStubError] = useState('');

  useEffect(() => {
    if (initialUrlStub && urlStub === '') {
      setUrlStub(initialUrlStub);
    }
  }, [initialUrlStub, urlStub]);

  const setUrlStubMutation = useMutation({
    mutationFn: (stub: string) => client.setUrlStub({ stub }),
    onSuccess: () => {
      setUrlStubError('');
      queryClient.invalidateQueries({ queryKey: profileQueryKey });
    },
    onError: (err: Error) => {
      setUrlStubError(err.message);
    },
  });

  const urlStubDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const handleUrlStubChange = (value: string) => {
    const sanitized = value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
    setUrlStub(sanitized);
    setUrlStubError('');
    if (urlStubDebounceRef.current) clearTimeout(urlStubDebounceRef.current);
    if (sanitized.length >= 3) {
      urlStubDebounceRef.current = setTimeout(() => {
        setUrlStubMutation.mutate(sanitized);
      }, 800);
    }
  };

  return (
    <>
      <EditSection label="Tagline" complete={!!tagline.trim()}>
        <div className="px-4 py-3 border-b border-muted/30 space-y-1">
          <MagneticField>
            <input
              type="text"
              value={tagline}
              onChange={(e) => handleFieldChange('tagline', e.target.value, setTagline)}
              placeholder="What do you do? e.g. 'Unity developer & pixel art enthusiast'"
              maxLength={120}
              className="w-full bg-transparent border-b border-muted/15 pb-1.5 font-mono text-sm text-foreground placeholder-muted-foreground/20 outline-none focus:border-primary/40 hover:border-muted/40 transition-colors"
            />
          </MagneticField>
          <div className="flex justify-end">
            <CharCount current={tagline.length} min={5} max={120} />
          </div>
        </div>
      </EditSection>

      <EditSection label="Bio" complete={!!bio.trim()}>
        <div className="px-4 py-3 border-b border-muted/30 space-y-1">
          <MagneticField bounce={0.01}>
            <textarea
              value={bio}
              onChange={(e) => handleFieldChange('bio', e.target.value, setBio)}
              placeholder="Tell the community about yourself, your experience, what you're working on..."
              rows={4}
              maxLength={500}
              className="w-full bg-muted/5 border border-muted/15 p-2.5 font-mono text-xs text-foreground placeholder-muted-foreground/20 outline-none focus:border-primary/40 hover:border-muted/40 hover:bg-muted/10 resize-none transition-all leading-relaxed"
            />
          </MagneticField>
          <div className="flex justify-end">
            <CharCount current={bio.length} min={20} max={500} />
          </div>
        </div>
      </EditSection>

      <EditSection label="Skills" complete={visibleSkills.length > 0}>
        <div className="px-4 py-3 border-b border-muted/30">
          {visibleSkills.length === 0 && visiblePendingRequests.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-2">
              <p className="font-mono text-[10px] text-muted-foreground/30 tracking-wider">
                No skills added yet
              </p>
              <SkillAutocomplete
                onAddSkill={(skillId) => addUserSkillMutation.mutate(skillId)}
                onRequestSkill={(name) => requestSkillMutation.mutate(name)}
              />
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {visibleSkills.map((skill) => (
                <SkillTag
                  key={skill.id}
                  name={skill.name}
                  onRemove={() => removeUserSkillMutation.mutate(skill.id)}
                />
              ))}
              {visiblePendingRequests.map((name) => (
                <PendingSkillTag
                  key={name}
                  name={name}
                  onRemove={() => cancelSkillRequestMutation.mutate(name)}
                />
              ))}
              <SkillAutocomplete
                onAddSkill={(skillId) => addUserSkillMutation.mutate(skillId)}
                onRequestSkill={(name) => requestSkillMutation.mutate(name)}
              />
            </div>
          )}
        </div>
      </EditSection>

      <EditSection label="Profile URL">
        <div className="px-4 py-3 border-b border-muted/30 space-y-1.5">
          <MagneticField>
            <div className="flex items-center gap-1 hover:bg-muted/5 -mx-1 px-1 py-0.5 rounded transition-colors">
              <span className="font-mono text-[10px] text-muted-foreground/40 shrink-0">/profile/</span>
              <input
                type="text"
                value={urlStub}
                onChange={(e) => handleUrlStubChange(e.target.value)}
                placeholder="your-name"
                maxLength={32}
                className="flex-1 bg-transparent border-b border-muted/15 pb-0.5 font-mono text-xs text-foreground placeholder-muted-foreground/20 outline-none focus:border-primary/50 hover:border-muted/40 transition-colors"
              />
            </div>
          </MagneticField>
          <div className="flex justify-between items-center">
            <div>
              {urlStubError && (
                <p className="font-mono text-[10px] text-destructive">{urlStubError}</p>
              )}
              {!urlStubError && urlStub.length >= 3 && initialUrlStub === urlStub && (
                <p className="font-mono text-[10px] text-green-500">Saved</p>
              )}
            </div>
            <CharCount current={urlStub.length} min={3} max={32} />
          </div>
        </div>
      </EditSection>

      <EditSection label="Linked Accounts" complete={!!itchIoAccount}>
        <div className="px-4 py-3 border-b border-muted/30 space-y-2">
          {itchIoAccount ? (
            <MagneticField>
              <div className="flex items-center justify-between gap-2 bg-muted/5 border border-muted/15 px-2.5 py-2 hover:border-muted/40 transition-all">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-primary/60 shrink-0">
                    <HugeiconsIcon icon={GameController01Icon} size={14} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-foreground truncate">
                      {itchIoAccount.providerUsername}
                    </p>
                    {itchIoAccount.providerProfileUrl && (
                      <a
                        href={itchIoAccount.providerProfileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[10px] text-muted-foreground/50 hover:text-primary/60 transition-colors truncate block"
                      >
                        {itchIoAccount.providerProfileUrl}
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => importItchIoGamesMutation.mutate()}
                    disabled={importItchIoGamesMutation.isPending}
                    className="font-mono text-[10px] text-muted-foreground/50 hover:text-primary/80 transition-colors px-1.5 py-0.5 hover:bg-muted/10 disabled:opacity-50"
                  >
                    {importItchIoGamesMutation.isPending ? 'Importing...' : 'Import games'}
                  </button>
                  <button
                    type="button"
                    onClick={() => unlinkItchIoMutation.mutate()}
                    disabled={unlinkItchIoMutation.isPending}
                    className="text-muted-foreground/30 hover:text-destructive transition-colors p-0.5 disabled:opacity-50"
                    title="Unlink itch.io"
                  >
                    <HugeiconsIcon icon={Delete02Icon} size={12} />
                  </button>
                </div>
              </div>
            </MagneticField>
          ) : (
            <MagneticField>
              <button
                type="button"
                onClick={handleLinkItchIo}
                className="w-full flex items-center justify-center gap-2 bg-muted/5 border border-dashed border-muted/20 px-2.5 py-2.5 hover:border-primary/30 hover:bg-muted/10 transition-all group/link-btn"
              >
                <HugeiconsIcon icon={Link01Icon} size={13} className="text-muted-foreground/30 group-hover/link-btn:text-primary/50 transition-colors" />
                <span className="font-mono text-[10px] text-muted-foreground/40 group-hover/link-btn:text-foreground/60 transition-colors tracking-wider">
                  Link itch.io account
                </span>
              </button>
            </MagneticField>
          )}
        </div>
      </EditSection>

      <EditSection label="Links" complete={!!(githubUrl || twitterUrl || websiteUrl)}>
        <div className="px-4 py-3 border-b border-muted/30 space-y-2">
          <LinkInput
            icon={<HugeiconsIcon icon={Github01Icon} size={13} />}
            value={githubUrl}
            onChange={(v) => handleFieldChange('githubUrl', v, setGithubUrl)}
            placeholder="github.com/username"
          />
          <LinkInput
            icon={<HugeiconsIcon icon={NewTwitterIcon} size={13} />}
            value={twitterUrl}
            onChange={(v) => handleFieldChange('twitterUrl', v, setTwitterUrl)}
            placeholder="twitter.com/username"
          />
          <LinkInput
            icon={<HugeiconsIcon icon={Globe02Icon} size={13} />}
            value={websiteUrl}
            onChange={(v) => handleFieldChange('websiteUrl', v, setWebsiteUrl)}
            placeholder="portfolio.dev"
          />
        </div>
      </EditSection>

      <EditSection label="Projects" complete={visibleProjects.length > 0}>
        <div className="px-4 py-3 border-b border-muted/30 space-y-2">
          {visibleProjects.length === 0 ? (
            <div className="text-center py-2">
              <p className="font-mono text-[10px] text-muted-foreground/30 tracking-wider mb-2">
                Showcase your work
              </p>
              <AddProjectForm onAdd={(data) => addProjectMutation.mutate(data)} />
            </div>
          ) : (
            <>
              {visibleProjects.map((project) => (
                <EditableProjectCard
                  key={project.id}
                  project={project}
                  onRemove={() => removeProjectMutation.mutate(project.id)}
                />
              ))}
              <AddProjectForm onAdd={(data) => addProjectMutation.mutate(data)} />
            </>
          )}
        </div>
      </EditSection>

      <EditSection label="Jam History" complete={visibleJams.length > 0}>
        <div className="px-4 py-3 space-y-2">
          {visibleJams.length === 0 ? (
            <div className="text-center py-2">
              <p className="font-mono text-[10px] text-muted-foreground/30 tracking-wider mb-2">
                Track your competition history
              </p>
              <AddJamForm onAdd={(data) => addJamMutation.mutate(data)} />
            </div>
          ) : (
            <>
              {visibleJams.map((jam) => (
                <EditableJamEntry
                  key={jam.id}
                  jam={jam}
                  onRemove={() => removeJamMutation.mutate(jam.id)}
                />
              ))}
              <AddJamForm onAdd={(data) => addJamMutation.mutate(data)} />
            </>
          )}
        </div>
      </EditSection>
    </>
  );
}
