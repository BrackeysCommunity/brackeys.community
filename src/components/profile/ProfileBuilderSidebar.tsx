import {
  Add01Icon,
  Cancel01Icon,
  Delete02Icon,
  Login01Icon,
  Share01Icon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useStore } from '@tanstack/react-store';
import { motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { NotchedCard } from '@/components/ui/notched-card';
import { authStore } from '@/lib/auth-store';
import { useMagnetic } from '@/lib/hooks/use-cursor';
import { cn } from '@/lib/utils';
import { client, orpc } from '@/orpc/client';

const springTransition = { type: 'spring', stiffness: 1000, damping: 30, mass: 0.1 } as const;

function MagneticFooterButton({
  onClick,
  children,
  className,
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
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
      <button type="button" onClick={onClick} disabled={disabled} className={className}>
        {children}
      </button>
    </motion.div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-2 border-b border-muted/30">
      <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase">
        {children}
      </span>
    </div>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/50 uppercase">
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-muted/20 border border-muted/30 px-2.5 py-1.5 font-mono text-xs text-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50 transition-colors"
      />
    </div>
  );
}

function UnauthenticatedSidebar() {
  return (
    <div className="flex h-full flex-col p-6 selection:bg-primary selection:text-white">
      <NotchedCard
        className="flex-1 min-h-0"
        scrollable={false}
      >
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center space-y-4">
            <h3 className="font-mono text-sm tracking-[0.2em] text-destructive uppercase">{'// ACCESS DENIED'}</h3>
            <p className="font-mono text-xs text-muted-foreground max-w-[240px]">
              Authenticate with Discord to access the profile editor.
            </p>
            <button
              type="button"
              onClick={() => {
                import('@/lib/auth-client').then(({ authClient }) =>
                  authClient.signIn.social({ provider: 'discord' }),
                );
              }}
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'border-primary/60 text-primary hover:bg-primary/10 hover:border-primary font-mono text-[10px] font-bold tracking-widest uppercase gap-2',
              )}
            >
              <HugeiconsIcon icon={Login01Icon} size={13} />
              Sign In with Discord
            </button>
          </div>
        </div>
      </NotchedCard>
    </div>
  );
}

function SkillTag({
  name,
  onRemove,
}: {
  name: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 bg-primary/10 border border-primary/30 px-2 py-0.5 font-mono text-[10px] text-primary uppercase tracking-wider">
      {name}
      <button
        type="button"
        onClick={onRemove}
        className="hover:text-destructive transition-colors"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={10} />
      </button>
    </span>
  );
}

function PendingSkillTag({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 bg-muted/20 border border-muted/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
      {name}
      <span className="text-[10px] text-brackeys-yellow">PENDING</span>
    </span>
  );
}

function SkillAutocomplete({
  onAddSkill,
  onRequestSkill,
}: {
  onAddSkill: (skillId: number) => void;
  onRequestSkill: (name: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  const { data: skillResults } = useQuery({
    ...orpc.listSkills.queryOptions({ input: { search: debouncedSearch || undefined } }),
    enabled: debouncedSearch.length > 0,
  });

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const hasExactMatch = skillResults?.some(
    (s) => s.name.toLowerCase() === search.trim().toLowerCase(),
  );

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setShowDropdown(true);
        }}
        onFocus={() => {
          if (search.trim()) setShowDropdown(true);
        }}
        placeholder="+ Add skill..."
        className="bg-transparent border border-dashed border-muted/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50 w-32 transition-colors"
      />
      {showDropdown && search.trim() && (
        <div className="absolute top-full left-0 mt-1 w-48 max-h-40 overflow-y-auto bg-card border border-muted/60 shadow-lg z-50">
          {skillResults?.map((skill) => (
            <button
              key={skill.id}
              type="button"
              onClick={() => {
                onAddSkill(skill.id);
                setSearch('');
                setShowDropdown(false);
              }}
              className="w-full text-left px-2 py-1.5 font-mono text-[10px] text-foreground hover:bg-primary/10 hover:text-primary transition-colors uppercase tracking-wider"
            >
              {skill.name}
              {skill.category && (
                <span className="text-muted-foreground/50 ml-1">({skill.category})</span>
              )}
            </button>
          ))}
          {!hasExactMatch && search.trim() && (
            <button
              type="button"
              onClick={() => {
                onRequestSkill(search.trim());
                setSearch('');
                setShowDropdown(false);
              }}
              className="w-full text-left px-2 py-1.5 font-mono text-[10px] text-brackeys-yellow hover:bg-brackeys-yellow/10 transition-colors uppercase tracking-wider border-t border-muted/30"
            >
              Request &apos;{search.trim()}&apos;
            </button>
          )}
          {skillResults?.length === 0 && hasExactMatch && (
            <div className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground/50">
              No skills found
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectCard({
  project,
  onRemove,
}: {
  project: { id: number; title: string; description?: string | null; url?: string | null; imageUrl?: string | null; status: string };
  onRemove: () => void;
}) {
  return (
    <div className="border border-muted/30 bg-muted/10 p-3 space-y-1">
      <div className="flex justify-between items-start gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs font-bold text-foreground uppercase tracking-wider truncate">{project.title}</span>
          {project.status === 'pending' && (
            <span className="shrink-0 bg-brackeys-yellow/10 border border-brackeys-yellow/30 px-1.5 py-0.5 font-mono text-[10px] text-brackeys-yellow uppercase tracking-wider">
              PENDING
            </span>
          )}
        </div>
        <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
          <HugeiconsIcon icon={Delete02Icon} size={12} />
        </button>
      </div>
      {project.imageUrl && (
        <img src={project.imageUrl} alt={project.title} className="w-full h-24 object-cover border border-muted/20" />
      )}
      {project.description && (
        <p className="font-mono text-[10px] text-muted-foreground line-clamp-2">{project.description}</p>
      )}
      {project.url && (
        <a href={project.url} target="_blank" rel="noopener noreferrer" className="font-mono text-[10px] text-primary hover:underline truncate block">
          {project.url}
        </a>
      )}
    </div>
  );
}

function AddProjectForm({ onAdd }: { onAdd: (data: { title: string; description?: string; url?: string; imageUrl?: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  const handleSubmit = () => {
    if (!title.trim()) return;
    onAdd({
      title: title.trim(),
      description: description.trim() || undefined,
      url: url.trim() || undefined,
      imageUrl: imageUrl.trim() || undefined,
    });
    setTitle('');
    setDescription('');
    setUrl('');
    setImageUrl('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full border border-dashed border-muted/40 py-2 font-mono text-[10px] text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors uppercase tracking-widest"
      >
        <HugeiconsIcon icon={Add01Icon} size={10} className="inline mr-1" />
        Add Project
      </button>
    );
  }

  return (
    <div className="border border-primary/30 bg-primary/5 p-3 space-y-2">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Project title"
        className="w-full bg-transparent border border-muted/30 px-2 py-1 font-mono text-xs text-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50"
      />
      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        className="w-full bg-transparent border border-muted/30 px-2 py-1 font-mono text-xs text-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50"
      />
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="URL (optional)"
        className="w-full bg-transparent border border-muted/30 px-2 py-1 font-mono text-xs text-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50"
      />
      <input
        type="text"
        value={imageUrl}
        onChange={(e) => setImageUrl(e.target.value)}
        placeholder="Image URL (optional)"
        className="w-full bg-transparent border border-muted/30 px-2 py-1 font-mono text-xs text-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          className="flex-1 bg-primary/20 border border-primary/40 py-1 font-mono text-[10px] text-primary uppercase tracking-widest hover:bg-primary/30 transition-colors"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex-1 border border-muted/30 py-1 font-mono text-[10px] text-muted-foreground uppercase tracking-widest hover:border-muted/60 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function JamEntry({
  jam,
  onRemove,
}: {
  jam: { id: number; jamName: string; submissionTitle?: string | null; result?: string | null };
  onRemove: () => void;
}) {
  return (
    <div className="border border-muted/30 bg-muted/10 p-3 space-y-1">
      <div className="flex justify-between items-start gap-2">
        <span className="font-mono text-xs font-bold text-foreground uppercase tracking-wider">{jam.jamName}</span>
        <button type="button" onClick={onRemove} className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
          <HugeiconsIcon icon={Delete02Icon} size={12} />
        </button>
      </div>
      {jam.submissionTitle && (
        <p className="font-mono text-[10px] text-muted-foreground">{jam.submissionTitle}</p>
      )}
      {jam.result && (
        <span className="inline-block bg-brackeys-yellow/10 border border-brackeys-yellow/30 px-1.5 py-0.5 font-mono text-[10px] text-brackeys-yellow uppercase">
          {jam.result}
        </span>
      )}
    </div>
  );
}

function AddJamForm({ onAdd }: { onAdd: (data: { jamName: string; submissionTitle?: string; submissionUrl?: string; result?: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [jamName, setJamName] = useState('');
  const [submissionTitle, setSubmissionTitle] = useState('');
  const [result, setResult] = useState('');

  const handleSubmit = () => {
    if (!jamName.trim()) return;
    onAdd({
      jamName: jamName.trim(),
      submissionTitle: submissionTitle.trim() || undefined,
      result: result.trim() || undefined,
    });
    setJamName('');
    setSubmissionTitle('');
    setResult('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full border border-dashed border-muted/40 py-2 font-mono text-[10px] text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors uppercase tracking-widest"
      >
        <HugeiconsIcon icon={Add01Icon} size={10} className="inline mr-1" />
        Add Jam Entry
      </button>
    );
  }

  return (
    <div className="border border-primary/30 bg-primary/5 p-3 space-y-2">
      <input
        type="text"
        value={jamName}
        onChange={(e) => setJamName(e.target.value)}
        placeholder="Jam name (e.g. Brackeys 2025.1)"
        className="w-full bg-transparent border border-muted/30 px-2 py-1 font-mono text-xs text-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50"
      />
      <input
        type="text"
        value={submissionTitle}
        onChange={(e) => setSubmissionTitle(e.target.value)}
        placeholder="Submission title (optional)"
        className="w-full bg-transparent border border-muted/30 px-2 py-1 font-mono text-xs text-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50"
      />
      <input
        type="text"
        value={result}
        onChange={(e) => setResult(e.target.value)}
        placeholder="Result (optional, e.g. 3rd Place)"
        className="w-full bg-transparent border border-muted/30 px-2 py-1 font-mono text-xs text-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          className="flex-1 bg-primary/20 border border-primary/40 py-1 font-mono text-[10px] text-primary uppercase tracking-widest hover:bg-primary/30 transition-colors"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex-1 border border-muted/30 py-1 font-mono text-[10px] text-muted-foreground uppercase tracking-widest hover:border-muted/60 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function AuthenticatedSidebar() {
  const { session } = useStore(authStore);
  const queryClient = useQueryClient();

  const profileQueryOptions = orpc.getMyProfile.queryOptions({ input: {} });
  const { data: profileData, isLoading } = useQuery({
    ...profileQueryOptions,
    staleTime: 30 * 1000,
  });

  const profile = profileData?.profile;
  const skills = profileData?.skills ?? [];
  const projects = profileData?.projects ?? [];
  const jams = profileData?.jams ?? [];
  const serverPendingNames = useMemo(
    () => (profileData?.pendingSkillRequests ?? []).map((r) => r.name),
    [profileData?.pendingSkillRequests],
  );
  const [localPendingRequests, setLocalPendingRequests] = useState<string[]>([]);
  const pendingRequests = useMemo(() => {
    const all = new Set([...serverPendingNames, ...localPendingRequests]);
    return Array.from(all);
  }, [serverPendingNames, localPendingRequests]);

  // Local form state
  const [tagline, setTagline] = useState('');
  const [bio, setBio] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [twitterUrl, setTwitterUrl] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const initialized = useRef(false);

  // Auto-sync fallback: if authenticated but no profile, trigger sync silently
  const syncFallbackRef = useRef(false);
  const syncFallbackMutation = useMutation({
    mutationFn: () => client.syncDiscordData({}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileQueryOptions.queryKey }),
  });

  useEffect(() => {
    if (!isLoading && !profile && !syncFallbackRef.current) {
      syncFallbackRef.current = true;
      syncFallbackMutation.mutate();
    }
  }, [isLoading, profile]);

  useEffect(() => {
    if (profile && !initialized.current) {
      setTagline(profile.tagline ?? '');
      setBio(profile.bio ?? '');
      setGithubUrl(profile.githubUrl ?? '');
      setTwitterUrl(profile.twitterUrl ?? '');
      setWebsiteUrl(profile.websiteUrl ?? '');
      initialized.current = true;
    }
  }, [profile]);

  // Auto-save with debounce
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const updateMutation = useMutation({
    mutationFn: (input: Parameters<typeof client.updateProfile>[0]) =>
      client.updateProfile(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileQueryOptions.queryKey }),
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

  // Skills mutations
  const addUserSkillMutation = useMutation({
    mutationFn: (skillId: number) => client.addUserSkill({ skillId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileQueryOptions.queryKey }),
  });

  const removeUserSkillMutation = useMutation({
    mutationFn: (userSkillId: number) => client.removeUserSkill({ userSkillId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileQueryOptions.queryKey }),
  });

  const requestSkillMutation = useMutation({
    mutationFn: (name: string) => client.requestSkill({ name }),
    onSuccess: (_data, name) => {
      setLocalPendingRequests((prev) => [...prev, name]);
    },
  });

  // Projects mutations
  const addProjectMutation = useMutation({
    mutationFn: (data: { title: string; description?: string; url?: string; imageUrl?: string }) =>
      client.addProject(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileQueryOptions.queryKey }),
  });

  const removeProjectMutation = useMutation({
    mutationFn: (projectId: number) => client.removeProject({ projectId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileQueryOptions.queryKey }),
  });

  // Jams mutations
  const addJamMutation = useMutation({
    mutationFn: (data: { jamName: string; submissionTitle?: string; submissionUrl?: string; result?: string }) =>
      client.addJamParticipation(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileQueryOptions.queryKey }),
  });

  const removeJamMutation = useMutation({
    mutationFn: (jamId: number) => client.removeJamParticipation({ jamId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: profileQueryOptions.queryKey }),
  });

  // URL stub
  const [urlStub, setUrlStub] = useState('');
  const [urlStubError, setUrlStubError] = useState('');
  const urlStubInitialized = useRef(false);

  useEffect(() => {
    if (profileData?.urlStub && !urlStubInitialized.current) {
      setUrlStub(profileData.urlStub);
      urlStubInitialized.current = true;
    }
  }, [profileData?.urlStub]);

  const setUrlStubMutation = useMutation({
    mutationFn: (stub: string) => client.setUrlStub({ stub }),
    onSuccess: () => {
      setUrlStubError('');
      queryClient.invalidateQueries({ queryKey: profileQueryOptions.queryKey });
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

  const username = session?.user?.name ?? 'Unknown';

  const headerContent = (
    <div className="flex items-center justify-between">
      <span className="font-mono text-xs font-bold tracking-widest text-muted-foreground uppercase">
        {'DEV // '}{username.toUpperCase()}
      </span>
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
        </span>
        <span className="font-mono text-xs font-bold tracking-widest text-green-500">ONLINE</span>
      </div>
    </div>
  );

  const footerContent = profile ? (
    <div className="px-6 py-4 flex gap-4">
      <MagneticFooterButton
        onClick={() => {
          const slug = profileData?.urlStub ?? session?.user?.id;
          if (slug) {
            window.open(`/profile/${slug}`, '_blank');
          }
        }}
        className={cn(
          buttonVariants({ variant: 'outline', size: 'sm' }),
          'w-full border-brackeys-yellow/40 text-brackeys-yellow hover:bg-brackeys-yellow/10 hover:border-brackeys-yellow font-mono text-[10px] font-bold tracking-widest uppercase justify-between',
        )}
      >
        View Public
        <HugeiconsIcon icon={Share01Icon} size={13} />
      </MagneticFooterButton>
    </div>
  ) : undefined;

  if (isLoading || !profile) {
    return (
      <div className="flex h-full flex-col p-6 selection:bg-primary selection:text-white">
        <NotchedCard
          className="flex-1 min-h-0"
          header={headerContent}
          scrollable={false}
        >
          <div className="flex-1 flex items-center justify-center p-12">
            <span className="font-mono text-xs text-muted-foreground animate-pulse tracking-widest uppercase">
              {isLoading ? 'Loading profile data...' : 'Setting up profile...'}
            </span>
          </div>
        </NotchedCard>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col p-6 selection:bg-primary selection:text-white">
      <NotchedCard
        className="flex-1 min-h-0"
        header={headerContent}
        footer={footerContent}
      >
                {/* Discord info (read-only) */}
                <div className="px-4 py-4 border-b border-muted/30 flex items-center gap-3">
                  {profile.avatarUrl ? (
                    <img
                      src={profile.avatarUrl}
                      alt={username}
                      className="w-10 h-10 rounded-full border border-muted/40 shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-muted/30 border border-muted/40 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-bold text-foreground truncate">
                      @{profile.discordUsername ?? username}
                    </p>
                    {profile.guildRoles && profile.guildRoles.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {profile.guildRoles.slice(0, 5).map((role) => (
                          <span
                            key={role}
                            className="bg-muted/30 border border-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground uppercase"
                          >
                            {role}
                          </span>
                        ))}
                      </div>
                    )}
                    {profile.guildJoinedAt && (
                      <p className="font-mono text-[10px] text-muted-foreground/50 mt-1">
                        Joined {new Date(profile.guildJoinedAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                      </p>
                    )}
                  </div>
                </div>

                {/* Tagline */}
                <SectionHeader>Tagline</SectionHeader>
                <div className="px-4 py-3 border-b border-muted/30">
                  <input
                    type="text"
                    value={tagline}
                    onChange={(e) => handleFieldChange('tagline', e.target.value, setTagline)}
                    placeholder="A short tagline about yourself..."
                    maxLength={120}
                    className="w-full bg-transparent border-b border-muted/20 pb-1 font-mono text-xs text-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50 transition-colors"
                  />
                </div>

                {/* Bio */}
                <SectionHeader>Bio</SectionHeader>
                <div className="px-4 py-3 border-b border-muted/30">
                  <textarea
                    value={bio}
                    onChange={(e) => handleFieldChange('bio', e.target.value, setBio)}
                    placeholder="Tell the community about yourself..."
                    rows={3}
                    maxLength={500}
                    className="w-full bg-transparent border border-muted/20 p-2 font-mono text-xs text-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50 resize-none transition-colors"
                  />
                </div>

                {/* Skills */}
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

                {/* Profile URL */}
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
                  {urlStubError && (
                    <p className="font-mono text-[10px] text-destructive">{urlStubError}</p>
                  )}
                  {!urlStubError && urlStub.length >= 3 && profileData?.urlStub === urlStub && (
                    <p className="font-mono text-[10px] text-green-500">Saved</p>
                  )}
                </div>

                {/* Links */}
                <SectionHeader>Links</SectionHeader>
                <div className="px-4 py-3 border-b border-muted/30 space-y-2.5">
                  <FieldInput
                    label="GitHub"
                    value={githubUrl}
                    onChange={(v) => handleFieldChange('githubUrl', v, setGithubUrl)}
                    placeholder="https://github.com/username"
                  />
                  <FieldInput
                    label="Twitter"
                    value={twitterUrl}
                    onChange={(v) => handleFieldChange('twitterUrl', v, setTwitterUrl)}
                    placeholder="https://twitter.com/username"
                  />
                  <FieldInput
                    label="Website"
                    value={websiteUrl}
                    onChange={(v) => handleFieldChange('websiteUrl', v, setWebsiteUrl)}
                    placeholder="https://portfolio.dev"
                  />
                </div>

                {/* Projects */}
                <SectionHeader>Projects</SectionHeader>
                <div className="px-4 py-3 border-b border-muted/30 space-y-2">
                  {projects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      onRemove={() => removeProjectMutation.mutate(project.id)}
                    />
                  ))}
                  <AddProjectForm onAdd={(data) => addProjectMutation.mutate(data)} />
                </div>

                {/* Jam History */}
                <SectionHeader>Jam History</SectionHeader>
                <div className="px-4 py-3 space-y-2">
                  {jams.map((jam) => (
                    <JamEntry
                      key={jam.id}
                      jam={jam}
                      onRemove={() => removeJamMutation.mutate(jam.id)}
                    />
                  ))}
                  <AddJamForm onAdd={(data) => addJamMutation.mutate(data)} />
                </div>
      </NotchedCard>
    </div>
  );
}

export function ProfileBuilderSidebar() {
  const { session, isPending } = useStore(authStore);

  if (isPending) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center p-6">
        <span className="font-mono text-xs text-muted-foreground animate-pulse tracking-widest uppercase">
          Authenticating...
        </span>
      </div>
    );
  }

  if (!session?.user) {
    return <UnauthenticatedSidebar />;
  }

  return <AuthenticatedSidebar />;
}
