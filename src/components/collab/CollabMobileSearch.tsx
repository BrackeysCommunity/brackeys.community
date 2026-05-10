import { FilterHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useStore } from "@tanstack/react-store";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { collabStore, setCollabFilters } from "@/lib/collab-store";

interface CollabMobileSearchProps {
  onOpenFilters: () => void;
}

/**
 * Mobile search field + filter trigger row. Owns its own debounced
 * search input so the keystrokes don't churn the global filter store
 * on every key.
 */
export function CollabMobileSearch({ onOpenFilters }: CollabMobileSearchProps) {
  const { filters } = useStore(collabStore);
  const [search, setSearch] = useState(filters.search);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setCollabFilters({ search });
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search]);

  return (
    <div className="flex items-center gap-2">
      <SearchField
        value={search}
        onChange={setSearch}
        placeholder="Search posts, projects, devs…"
        containerClassName="flex-1 dark:bg-emboss-surface!"
      />
      <Button
        variant="outline"
        size="sm"
        onClick={onOpenFilters}
        className="font-mono tracking-widest"
      >
        <HugeiconsIcon icon={FilterHorizontalIcon} size={13} />
        FILTER
      </Button>
    </div>
  );
}
