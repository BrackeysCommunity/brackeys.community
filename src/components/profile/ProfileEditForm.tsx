import { Github01Icon, Globe02Icon, NewTwitterIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CharCount, SectionHeader } from '@/components/ui/form-primitives';
import { client } from '@/orpc/client';
import { EditableJamEntry, AddJamForm } from './ProfileJamEditor';
import { EditableProjectCard, AddProjectForm } from './ProfileProjectEditor';
import { SkillTag, PendingSkillTag, SkillAutocomplete } from './ProfileSkillEditor';

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
  urlStub: string | null;
  profileQueryKey: readonly unknown[];
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
    <div className="flex items-center gap-2 bg-muted/10 border border-muted/20 px-2.5 py-1.5 focus-within:border-primary/40 transition-colors group">
      <span className="text-muted-foreground/40 group-focus-within:text-primary/50 transition-colors shrink-0">
        {icon}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-transparent font-mono text-xs text-foreground placeholder-muted-foreground/25 outline-none"
      />
    </div>
  );
}

function ProfileCompleteness({ tagline, bio, skills, projects, jams, githubUrl, twitterUrl, websiteUrl }: { tagline: string; bio: string; skills: unknown[]; projects: unknown[]; jams: unknown[]; githubUrl: string; twitterUrl: string; websiteUrl: string }) {
  const items = [
    { label: 'Tagline', ok: !!tagline.trim() },
    { label: 'Bio', ok: !!bio.trim() },
    { label: 'Skills', ok: skills.length > 0 },
    { label: 'Links', ok: !!(githubUrl || twitterUrl || websiteUrl) },
    { label: 'Projects', ok: projects.length > 0 },
    { label: 'Jams', ok: jams.length > 0 },
  ];
  const score = items.filter((i) => i.ok).length;
  if (score >= items.length) return null;
  return (
    <div className="px-4 py-3 border-b border-muted/30 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/50 uppercase">Completeness</span>
        <span className="font-mono text-[10px] text-primary">{score}/{items.length}</span>
      </div>
      <div className="flex gap-0.5">
        {items.map((item) => (
          <div key={item.label} className={`h-1 flex-1 transition-colors ${item.ok ? 'bg-primary' : 'bg-muted/30'}`} title={item.label} />
        ))}
      </div>
    </div>
  );
}

export function ProfileEditForm({
  profile,
  skills,
  projects,
  jams,
  pendingSkillRequests,
  urlStub: initialUrlStub,
  profileQueryKey,
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
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileQueryKey }),
  });

  const removeUserSkillMutation = useMutation({
    mutationFn: (userSkillId: number) => client.removeUserSkill({ userSkillId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileQueryKey }),
  });

  const requestSkillMutation = useMutation({
    mutationFn: (name: string) => client.requestSkill({ name }),
    onSuccess: (_data, name) => {
      setLocalPendingRequests((prev) => [...prev, name]);
    },
  });

  const addProjectMutation = useMutation({
    mutationFn: (data: { title: string; description?: string; url?: string; imageUrl?: string }) =>
      client.addProject(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileQueryKey }),
  });

  const removeProjectMutation = useMutation({
    mutationFn: (projectId: number) => client.removeProject({ projectId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileQueryKey }),
  });

  const addJamMutation = useMutation({
    mutationFn: (data: { jamName: string; submissionTitle?: string; submissionUrl?: string; result?: string }) =>
      client.addJamParticipation(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileQueryKey }),
  });

  const removeJamMutation = useMutation({
    mutationFn: (jamId: number) => client.removeJamParticipation({ jamId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileQueryKey }),
  });

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
      <ProfileCompleteness
        tagline={tagline}
        bio={bio}
        skills={skills}
        projects={projects}
        jams={jams}
        githubUrl={githubUrl}
        twitterUrl={twitterUrl}
        websiteUrl={websiteUrl}
      />

      <SectionHeader>Tagline</SectionHeader>
      <div className="px-4 py-3 border-b border-muted/30 space-y-1">
        <input
          type="text"
          value={tagline}
          onChange={(e) => handleFieldChange('tagline', e.target.value, setTagline)}
          placeholder="A short tagline about yourself..."
          maxLength={120}
          className="w-full bg-transparent border-b border-muted/20 pb-1.5 font-mono text-sm text-foreground placeholder-muted-foreground/25 outline-none focus:border-primary/40 transition-colors"
        />
        <div className="flex justify-end">
          <CharCount current={tagline.length} min={5} max={120} />
        </div>
      </div>

      <SectionHeader>Bio</SectionHeader>
      <div className="px-4 py-3 border-b border-muted/30 space-y-1">
        <textarea
          value={bio}
          onChange={(e) => handleFieldChange('bio', e.target.value, setBio)}
          placeholder="Tell the community about yourself..."
          rows={4}
          maxLength={500}
          className="w-full bg-transparent border border-muted/15 p-2.5 font-mono text-xs text-foreground placeholder-muted-foreground/25 outline-none focus:border-primary/40 resize-none transition-colors leading-relaxed"
        />
        <div className="flex justify-end">
          <CharCount current={bio.length} min={20} max={500} />
        </div>
      </div>

      <SectionHeader>Skills</SectionHeader>
      <div className="px-4 py-3 border-b border-muted/30">
        <div className="flex flex-wrap gap-1.5">
          {skills.map((skill) => (
            <SkillTag
              key={skill.id}
              name={skill.name}
              onRemove={() => removeUserSkillMutation.mutate(skill.id)}
            />
          ))}
          {pendingRequests.map((name) => (
            <PendingSkillTag key={name} name={name} />
          ))}
          <SkillAutocomplete
            onAddSkill={(skillId) => addUserSkillMutation.mutate(skillId)}
            onRequestSkill={(name) => requestSkillMutation.mutate(name)}
          />
        </div>
      </div>

      <SectionHeader>Profile URL</SectionHeader>
      <div className="px-4 py-3 border-b border-muted/30 space-y-1.5">
        <div className="flex items-center gap-1">
          <span className="font-mono text-[10px] text-muted-foreground/50 shrink-0">/profile/</span>
          <input
            type="text"
            value={urlStub}
            onChange={(e) => handleUrlStubChange(e.target.value)}
            placeholder="your-name"
            maxLength={32}
            className="flex-1 bg-transparent border-b border-muted/20 pb-0.5 font-mono text-xs text-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50 transition-colors"
          />
        </div>
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

      <SectionHeader>Links</SectionHeader>
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

      <SectionHeader>Projects</SectionHeader>
      <div className="px-4 py-3 border-b border-muted/30 space-y-2">
        {projects.map((project) => (
          <EditableProjectCard
            key={project.id}
            project={project}
            onRemove={() => removeProjectMutation.mutate(project.id)}
          />
        ))}
        <AddProjectForm onAdd={(data) => addProjectMutation.mutate(data)} />
      </div>

      <SectionHeader>Jam History</SectionHeader>
      <div className="px-4 py-3 space-y-2">
        {jams.map((jam) => (
          <EditableJamEntry
            key={jam.id}
            jam={jam}
            onRemove={() => removeJamMutation.mutate(jam.id)}
          />
        ))}
        <AddJamForm onAdd={(data) => addJamMutation.mutate(data)} />
      </div>
    </>
  );
}
