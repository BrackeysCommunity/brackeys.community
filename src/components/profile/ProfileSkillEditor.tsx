import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { orpc } from '@/orpc/client';

export function SkillTag({
  name,
  onRemove,
}: {
  name: string;
  onRemove: () => void;
}) {
  return (
    <span className="group inline-flex items-center gap-1 bg-primary/10 border border-primary/25 px-2 py-0.5 font-mono text-[10px] text-primary uppercase tracking-wider hover:border-primary/50 transition-colors">
      {name}
      <button
        type="button"
        onClick={onRemove}
        className="opacity-50 group-hover:opacity-100 hover:text-destructive transition-all"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={9} />
      </button>
    </span>
  );
}

export function PendingSkillTag({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 bg-brackeys-yellow/5 border border-brackeys-yellow/20 px-2 py-0.5 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
      {name}
      <span className="text-[9px] text-brackeys-yellow font-bold tracking-widest">PENDING</span>
    </span>
  );
}

export function SkillAutocomplete({
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
