import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { useMagnetic } from "@/lib/hooks/use-cursor";
import { orpc } from "@/orpc/client";

const springTransition = { type: "spring", stiffness: 1000, damping: 30, mass: 0.1 } as const;

export function SkillTag({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <span className="group inline-flex items-center gap-1 overflow-hidden border border-primary/25 bg-primary/10 px-2 py-0.5 font-mono text-[10px] tracking-wider text-primary uppercase transition-colors hover:border-primary/50">
      {name}
      <button
        type="button"
        onClick={onRemove}
        className="-mr-1 w-0 shrink-0 text-primary/50 opacity-0 transition-all duration-200 outline-none group-hover:w-3 group-hover:opacity-100 hover:text-destructive focus:w-3 focus:text-destructive focus:opacity-100"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={9} />
      </button>
    </span>
  );
}

export function PendingSkillTag({ name, onRemove }: { name: string; onRemove?: () => void }) {
  const { ref, position } = useMagnetic(0);
  return (
    <motion.span
      ref={ref as React.RefObject<HTMLSpanElement>}
      data-magnetic
      data-cursor-no-drift
      data-cursor-bounce={0.03}
      animate={{ x: position.x, y: position.y }}
      transition={springTransition}
      className="group inline-flex items-center gap-1.5 overflow-hidden border border-brackeys-yellow/20 bg-brackeys-yellow/5 px-2 py-0.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase transition-colors hover:border-brackeys-yellow/40"
    >
      {name}
      <span className="text-[9px] font-bold tracking-widest text-brackeys-yellow">PENDING</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="-mr-1.5 w-0 shrink-0 text-muted-foreground/50 opacity-0 transition-all duration-200 outline-none group-hover:mr-0 group-hover:w-3 group-hover:opacity-100 hover:text-destructive focus:mr-0 focus:w-3 focus:text-destructive focus:opacity-100"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={16} />
        </button>
      )}
    </motion.span>
  );
}

export function SkillAutocomplete({
  onAddSkill,
  onRequestSkill,
}: {
  onAddSkill: (skillId: number) => void;
  onRequestSkill: (name: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
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
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const hasExactMatch = skillResults?.some(
    (s) => s.name.toLowerCase() === search.trim().toLowerCase(),
  );

  const { ref: magnetRef, position } = useMagnetic(0);

  return (
    <motion.div
      ref={magnetRef as React.RefObject<HTMLDivElement>}
      data-magnetic
      data-cursor-no-drift
      animate={{ x: position.x, y: position.y }}
      transition={springTransition}
      className="relative"
    >
      <div ref={containerRef}>
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
          className="w-28 border border-dashed border-muted/40 bg-transparent px-2 py-0.5 font-mono text-[10px] text-muted-foreground placeholder-muted-foreground/30 transition-colors outline-none focus:border-primary/50"
        />
        {showDropdown && search.trim() && (
          <div className="absolute top-full left-0 z-50 mt-1 max-h-40 w-48 overflow-y-auto border border-muted/60 bg-card shadow-lg">
            {skillResults?.map((skill) => (
              <button
                key={skill.id}
                type="button"
                onClick={() => {
                  onAddSkill(skill.id);
                  setSearch("");
                  setShowDropdown(false);
                }}
                className="w-full px-2 py-1.5 text-left font-mono text-[10px] tracking-wider text-foreground uppercase transition-colors hover:bg-primary/10 hover:text-primary"
              >
                {skill.name}
                {skill.category && (
                  <span className="ml-1 text-muted-foreground/50">({skill.category})</span>
                )}
              </button>
            ))}
            {!hasExactMatch && search.trim() && (
              <button
                type="button"
                onClick={() => {
                  onRequestSkill(search.trim());
                  setSearch("");
                  setShowDropdown(false);
                }}
                className="w-full border-t border-muted/30 px-2 py-1.5 text-left font-mono text-[10px] tracking-wider text-brackeys-yellow uppercase transition-colors hover:bg-brackeys-yellow/10"
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
    </motion.div>
  );
}
