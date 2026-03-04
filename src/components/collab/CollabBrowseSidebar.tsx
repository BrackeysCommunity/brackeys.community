import {
  FilterIcon,
  Cancel01Icon,
  Add01Icon,
  Login01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Link } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { authClient } from '@/lib/auth-client'
import { authStore } from '@/lib/auth-store'
import { collabStore } from '@/lib/collab-store'
import { client } from '@/orpc/client'
import { CollabPostCard } from './CollabPostCard'
import { FilterContent } from './CollabBrowsePage'

const PAGE_SIZE = 20
const NOTCH_SIZE = 22
const notchClip = `polygon(0 0, calc(100% - ${NOTCH_SIZE}px) 0, 100% ${NOTCH_SIZE}px, 100% 100%, 0 100%)`
const notchClipInner = `polygon(0 0, calc(100% - ${NOTCH_SIZE - 2}px) 0, 100% ${NOTCH_SIZE - 2}px, 100% 100%, 0 100%)`

export function CollabBrowseSidebar() {
  const { filters } = useStore(collabStore)
  const { session, isPending } = useStore(authStore)
  const parentRef = useRef<HTMLDivElement>(null)
  const [showFilters, setShowFilters] = useState(false)

  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['listPosts', filters],
    queryFn: ({ pageParam = 0 }) =>
      client.listPosts({
        type: filters.type,
        subtype: filters.subtype,
        status: filters.status,
        search: filters.search || undefined,
        experienceLevel: filters.experienceLevel,
        compensationType: filters.compensationType,
        isIndividual: filters.isIndividual,
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
        limit: PAGE_SIZE,
        offset: pageParam as number,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const fetched = allPages.length * PAGE_SIZE
      if (fetched >= (lastPage.total ?? 0)) return undefined
      return fetched
    },
    staleTime: 15 * 1000,
  })

  const allPosts = useMemo(
    () => data?.pages.flatMap((p) => p.posts) ?? [],
    [data],
  )
  const total = data?.pages[0]?.total ?? 0

  const activeFilterCount = [
    filters.type,
    filters.subtype,
    filters.status,
    filters.experienceLevel,
    filters.compensationType,
    filters.isIndividual !== undefined ? true : undefined,
    filters.search,
  ].filter(Boolean).length

  const virtualizer = useVirtualizer({
    count: hasNextPage ? allPosts.length + 1 : allPosts.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 110,
    overscan: 5,
    gap: 12,
  })

  const virtualItems = virtualizer.getVirtualItems()

  useEffect(() => {
    const lastItem = virtualItems[virtualItems.length - 1]
    if (!lastItem) return
    if (lastItem.index >= allPosts.length - 1 && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [virtualItems, allPosts.length, hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <div className="flex h-full flex-col p-4 sm:p-6 selection:bg-primary selection:text-white pointer-events-auto relative">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 shrink-0">
        <span className="font-mono text-[11px] tracking-widest text-foreground uppercase">
          {!isLoading && total > 0 && `${total} POST${total !== 1 ? 'S' : ''}`}
        </span>
        <button
          type="button"
          onClick={() => setShowFilters(true)}
          className="lg:hidden flex items-center gap-1.5 px-2.5 py-1 border border-muted bg-muted/40 font-mono text-[11px] text-foreground/80 uppercase tracking-widest hover:border-primary hover:text-primary transition-colors"
        >
          <HugeiconsIcon icon={FilterIcon} size={12} />
          FILTER
          {activeFilterCount > 0 && (
            <span className="bg-primary/30 border border-primary/60 text-primary px-1 text-[9px]">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Create post CTA (mobile only) */}
      <div className="lg:hidden pb-3 shrink-0">
        {!isPending && (
          session?.user ? (
            <Link
              to="/collab/new"
              className="flex items-center justify-center gap-2 border border-primary/50 bg-primary/10 px-3 py-2 font-mono text-[11px] font-bold text-primary uppercase tracking-widest hover:bg-primary/20 transition-colors"
            >
              <HugeiconsIcon icon={Add01Icon} size={14} />
              CREATE POST
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => authClient.signIn.social({ provider: 'discord' })}
              className="w-full flex items-center justify-center gap-2 border border-primary/50 bg-primary/10 px-3 py-2 font-mono text-[11px] font-bold text-primary uppercase tracking-widest hover:bg-primary/20 transition-colors"
            >
              <HugeiconsIcon icon={Login01Icon} size={14} />
              SIGN IN TO POST
            </button>
          )
        )}
      </div>

      {/* Virtualized infinite-scroll post list */}
      <div
        ref={parentRef}
        className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={`skel-${i.toString()}`}
                className="border border-muted bg-muted/40 p-4 h-24 animate-pulse"
                style={{ animationDelay: `${i * 100}ms` }}
              />
            ))}
          </div>
        ) : allPosts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <span className="font-mono text-4xl text-muted-foreground/40">[ ]</span>
            <p className="font-mono text-xs text-muted-foreground tracking-widest uppercase">
              No posts match your filters
            </p>
          </div>
        ) : (
          <div
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualItems.map((virtualItem) => {
              const isLoader = virtualItem.index >= allPosts.length
              if (isLoader) {
                return (
                  <div
                    key="loader"
                    className="absolute top-0 left-0 w-full flex justify-center py-4"
                    style={{ transform: `translateY(${virtualItem.start}px)` }}
                  >
                    <span className="font-mono text-[11px] text-muted-foreground animate-pulse tracking-widest uppercase">
                      Loading more...
                    </span>
                  </div>
                )
              }
              const post = allPosts[virtualItem.index]
              return (
                <div
                  key={post.id}
                  className="absolute top-0 left-0 w-full"
                  style={{
                    height: `${virtualItem.size}px`,
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <CollabPostCard post={post} />
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Filter modal overlay */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm p-4"
            onClick={() => setShowFilters(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-md max-h-[80vh] bg-muted"
              style={{ clipPath: notchClip, padding: '2px' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="flex flex-col h-full bg-background backdrop-blur-md relative overflow-hidden"
                style={{ clipPath: notchClipInner }}
              >
                <span className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-brackeys-yellow/50 pointer-events-none z-10" />
                <span className="absolute top-0 left-0 w-2 h-2 border-t border-l border-brackeys-yellow/50 pointer-events-none z-10" />
                <svg
                  aria-hidden="true"
                  className="absolute top-0 right-0 pointer-events-none text-brackeys-yellow/40 z-10"
                  width={NOTCH_SIZE + 2}
                  height={NOTCH_SIZE + 2}
                  viewBox={`0 0 ${NOTCH_SIZE + 2} ${NOTCH_SIZE + 2}`}
                  fill="none"
                >
                  <line x1="0" y1="1" x2={NOTCH_SIZE + 1} y2={NOTCH_SIZE + 2} stroke="currentColor" strokeWidth="1" />
                </svg>

                <div className="flex items-center justify-between border-b border-muted bg-card/60 px-4 py-2.5 shrink-0">
                  <span className="font-mono text-xs font-bold tracking-widest text-muted-foreground uppercase">
                    {'COLLAB // FILTERS'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowFilters(false)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={14} />
                  </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-4">
                  <FilterContent onDone={() => setShowFilters(false)} />
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
