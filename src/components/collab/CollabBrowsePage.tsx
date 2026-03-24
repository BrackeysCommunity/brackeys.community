import {
  Add01Icon,
  Login01Icon,
  Search01Icon,
  FilterIcon,
  Cancel01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { useEffect, useRef, useState } from 'react'
import { NotchedCard } from '@/components/ui/notched-card'
import { authClient } from '@/lib/auth-client'
import { authStore } from '@/lib/auth-store'
import {
  type CollabCompensationType,
  type CollabExperienceLevel,
  type CollabPostType,
  type CollabSortBy,
  type CollabStatus,
  type CollabListingType,
  collabStore,
  resetCollabFilters,
  setCollabFilters,
} from '@/lib/collab-store'
import { usePageSidebar } from '@/lib/hooks/use-page-layout'
import { CollabBrowseSidebar } from './CollabBrowseSidebar'

const TYPE_OPTIONS: { value: CollabPostType; label: string; icon: string }[] = [
  { value: 'paid', label: 'PAID', icon: '$' },
  { value: 'hobby', label: 'HOBBY', icon: '~' },
  { value: 'playtest', label: 'PLAYTEST', icon: '>' },
  { value: 'mentor', label: 'MENTOR', icon: '*' },
]

const LISTING_TYPE_OPTIONS: { value: CollabListingType; label: string }[] = [
  { value: 'posts', label: 'PROJECTS' },
  { value: 'people', label: 'PEOPLE' },
]

const STATUS_OPTIONS: { value: CollabStatus; label: string }[] = [
  { value: 'recruiting', label: 'OPEN' },
  { value: 'party_full', label: 'CLOSED' },
]

const EXPERIENCE_OPTIONS: { value: CollabExperienceLevel; label: string }[] = [
  { value: 'any', label: 'ANY' },
  { value: 'beginner', label: 'BEGINNER' },
  { value: 'intermediate', label: 'INTERMEDIATE' },
  { value: 'experienced', label: 'EXPERIENCED' },
]

const COMP_OPTIONS: { value: CollabCompensationType; label: string }[] = [
  { value: 'hourly', label: 'HOURLY' },
  { value: 'fixed', label: 'FIXED' },
  { value: 'rev_share', label: 'REV SHARE' },
  { value: 'negotiable', label: 'NEGOTIABLE' },
]

const SORT_OPTIONS: { value: CollabSortBy; label: string }[] = [
  { value: 'createdAt', label: 'NEWEST' },
  { value: 'updatedAt', label: 'UPDATED' },
]

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[11px] font-bold tracking-widest text-foreground/80 uppercase">
      {children}
    </span>
  )
}

function FilterChip({
  label,
  active,
  onClick,
  accent,
}: {
  label: string
  active: boolean
  onClick: () => void
  accent?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider border transition-colors ${
        active
          ? `${accent ?? 'bg-primary/25 border-primary/60 text-primary'}`
          : 'bg-muted/30 border-muted/60 text-foreground/70 hover:border-muted hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )
}

export function FilterContent({ onDone }: { onDone?: () => void }) {
  const { filters } = useStore(collabStore)
  const [searchInput, setSearchInput] = useState(filters.search)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setCollabFilters({ search: searchInput })
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchInput])

  const activeFilterCount = [
    filters.type,
    filters.listingType,
    filters.status,
    filters.experienceLevel,
    filters.compensationType,
    filters.isIndividual !== undefined ? true : undefined,
    filters.search,
  ].filter(Boolean).length

  return (
    <div className="flex flex-col gap-5">
      {/* Search bar */}
      <div className="flex items-center gap-2 border border-muted bg-muted/40 px-3 py-2">
        <HugeiconsIcon icon={Search01Icon} size={14} className="text-foreground/80 shrink-0" />
        <input
          type="text"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search posts..."
          className="flex-1 bg-transparent font-mono text-xs text-foreground placeholder-muted-foreground outline-none"
        />
        {searchInput && (
          <button type="button" onClick={() => setSearchInput('')} className="text-muted-foreground hover:text-foreground">
            <HugeiconsIcon icon={Cancel01Icon} size={12} />
          </button>
        )}
      </div>

      {/* Filter header with reset */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={FilterIcon} size={14} className="text-foreground" />
          <span className="font-mono text-[11px] font-bold tracking-widest text-foreground uppercase">
            FILTERS
          </span>
          {activeFilterCount > 0 && (
            <span className="font-mono text-[10px] bg-primary/30 border border-primary/60 text-primary px-1.5 py-0.5">
              {activeFilterCount}
            </span>
          )}
        </div>
        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={() => {
              resetCollabFilters()
              setSearchInput('')
            }}
            className="font-mono text-[10px] text-foreground/80 hover:text-primary tracking-wider uppercase transition-colors"
          >
            CLEAR ALL
          </button>
        )}
      </div>

      {/* Post type */}
      <div className="space-y-2">
        <SectionLabel>Type</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {TYPE_OPTIONS.map((t) => (
            <FilterChip
              key={t.value}
              label={`${t.icon} ${t.label}`}
              active={filters.type === t.value}
              onClick={() => setCollabFilters({ type: filters.type === t.value ? undefined : t.value })}
            />
          ))}
        </div>
      </div>

      {/* Listing type */}
      <div className="space-y-2">
        <SectionLabel>Show</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {LISTING_TYPE_OPTIONS.map((lt) => (
            <FilterChip
              key={lt.value}
              label={lt.label}
              active={filters.listingType === lt.value}
              onClick={() => setCollabFilters({ listingType: filters.listingType === lt.value ? undefined : lt.value })}
            />
          ))}
        </div>
      </div>

      {/* Status */}
      <div className="space-y-2">
        <SectionLabel>Status</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_OPTIONS.map((s) => (
            <FilterChip
              key={s.value}
              label={s.label}
              active={filters.status === s.value}
              onClick={() => setCollabFilters({ status: filters.status === s.value ? undefined : s.value })}
              accent={
                s.value === 'recruiting'
                  ? 'bg-green-500/25 border-green-500/60 text-green-500'
                  : 'bg-destructive/25 border-destructive/60 text-destructive'
              }
            />
          ))}
        </div>
      </div>

      {/* Experience level */}
      <div className="space-y-2">
        <SectionLabel>Experience</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {EXPERIENCE_OPTIONS.map((e) => (
            <FilterChip
              key={e.value}
              label={e.label}
              active={filters.experienceLevel === e.value}
              onClick={() => setCollabFilters({ experienceLevel: filters.experienceLevel === e.value ? undefined : e.value })}
            />
          ))}
        </div>
      </div>

      {/* Compensation type (paid only) */}
      {filters.type === 'paid' && (
        <div className="space-y-2">
          <SectionLabel>Compensation</SectionLabel>
          <div className="flex flex-wrap gap-1.5">
            {COMP_OPTIONS.map((c) => (
              <FilterChip
                key={c.value}
                label={c.label}
                active={filters.compensationType === c.value}
                onClick={() => setCollabFilters({ compensationType: filters.compensationType === c.value ? undefined : c.value })}
                accent="bg-green-500/25 border-green-500/60 text-green-500"
              />
            ))}
          </div>
        </div>
      )}

      {/* Sort */}
      <div className="space-y-2">
        <SectionLabel>Sort By</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {SORT_OPTIONS.map((s) => (
            <FilterChip
              key={s.value}
              label={s.label}
              active={filters.sortBy === s.value}
              onClick={() => setCollabFilters({ sortBy: s.value })}
            />
          ))}
          <FilterChip
            label={filters.sortOrder === 'desc' ? 'DESC' : 'ASC'}
            active={false}
            onClick={() => setCollabFilters({ sortOrder: filters.sortOrder === 'desc' ? 'asc' : 'desc' })}
          />
        </div>
      </div>

      {onDone && (
        <button
          type="button"
          onClick={onDone}
          className="w-full bg-primary/30 border border-primary/60 py-2.5 font-mono text-[11px] text-primary uppercase tracking-widest hover:bg-primary/40 transition-colors"
        >
          DONE
        </button>
      )}
    </div>
  )
}

export function CollabBrowsePage() {
  const { session, isPending } = useStore(authStore)

  usePageSidebar(<CollabBrowseSidebar />)

  return (
    <div className="flex flex-col h-full gap-4 selection:bg-primary selection:text-white">
      {/* Create post / sign in CTA */}
      {!isPending && (
        <div className="shrink-0">
          {session?.user ? (
            <Link
              to="/collab/new"
              className="group flex items-center gap-3 border-2 border-primary bg-primary/5 px-4 py-3 font-mono text-sm font-bold text-primary transition-all hover:bg-primary/10 hover:shadow-[3px_3px_0px_var(--color-primary)] active:translate-y-px active:shadow-none pointer-events-auto"
            >
              <HugeiconsIcon icon={Add01Icon} size={18} />
              CREATE POST
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => authClient.signIn.social({ provider: 'discord' })}
              className="group flex items-center gap-3 border-2 border-primary bg-primary/5 px-4 py-3 font-mono text-sm font-bold text-primary transition-all hover:bg-primary/10 hover:shadow-[3px_3px_0px_var(--color-primary)] active:translate-y-px active:shadow-none pointer-events-auto"
            >
              <HugeiconsIcon icon={Login01Icon} size={18} />
              SIGN IN TO POST
            </button>
          )}
        </div>
      )}

      <NotchedCard
        className="flex-1 min-h-0"
        header={
          <span className="font-mono text-xs font-bold tracking-widest text-muted-foreground uppercase">
            {'COLLAB // FILTERS'}
          </span>
        }
      >
        <div className="p-4">
          <FilterContent />
        </div>
      </NotchedCard>
    </div>
  )
}
