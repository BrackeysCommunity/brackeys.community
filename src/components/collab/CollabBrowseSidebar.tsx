import { ArrowLeft01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useStore } from '@tanstack/react-store'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'
import { collabStore, setCollabPage } from '@/lib/collab-store'
import { orpc } from '@/orpc/client'
import { CollabPostCard } from './CollabPostCard'

export function CollabBrowseSidebar() {
  const { filters, pagination } = useStore(collabStore)
  const parentRef = useRef<HTMLDivElement>(null)

  const { data, isLoading } = useQuery({
    ...orpc.listPosts.queryOptions({
      input: {
        type: filters.type,
        subtype: filters.subtype,
        status: filters.status,
        search: filters.search || undefined,
        experienceLevel: filters.experienceLevel,
        compensationType: filters.compensationType,
        isIndividual: filters.isIndividual,
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
        limit: pagination.limit,
        offset: pagination.offset,
      },
    }),
    staleTime: 15 * 1000,
  })

  const posts = data?.posts ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pagination.limit))
  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1

  const virtualizer = useVirtualizer({
    count: posts.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 110,
    overscan: 5,
    gap: 12,
  })

  return (
    <div className="flex h-full flex-col p-6 selection:bg-primary selection:text-white">
      {/* Minimal header */}
      <div className="flex items-center justify-between pb-4 shrink-0">
        <span className="font-mono text-[10px] tracking-widest text-muted-foreground/40 uppercase">
          {isLoading ? 'LOADING...' : `${total} POST${total !== 1 ? 'S' : ''}`}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCollabPage(Math.max(0, pagination.offset - pagination.limit))}
            disabled={currentPage <= 1}
            className="p-1 font-mono text-muted-foreground/40 hover:text-primary disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
          </button>
          <span className="font-mono text-[10px] text-muted-foreground/40 tracking-widest tabular-nums">
            {currentPage}/{totalPages}
          </span>
          <button
            type="button"
            onClick={() => setCollabPage(pagination.offset + pagination.limit)}
            disabled={currentPage >= totalPages}
            className="p-1 font-mono text-muted-foreground/40 hover:text-primary disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
          >
            <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
          </button>
        </div>
      </div>

      {/* Virtualized floating cards */}
      <div
        ref={parentRef}
        className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="border border-muted/20 bg-muted/5 p-4 h-24 animate-pulse"
                style={{ animationDelay: `${i * 100}ms` }}
              />
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <span className="font-mono text-4xl text-muted-foreground/10">[ ]</span>
            <p className="font-mono text-xs text-muted-foreground/30 tracking-widest uppercase">
              No posts match your filters
            </p>
          </div>
        ) : (
          <div
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const post = posts[virtualItem.index]
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
    </div>
  )
}
