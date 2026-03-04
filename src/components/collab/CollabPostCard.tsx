import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

interface CollabPostCardProps {
  post: {
    id: number
    type: string
    subtype: string | null
    title: string
    status: string
    featuredAt: string | Date | null
    createdAt: string | Date | null
    authorId: string
    isIndividual?: boolean | null
    compensationType?: string | null
    teamSize?: string | null
  }
  responseCount?: number
  roles?: { id: number; name: string }[]
}

function timeAgo(date: string | Date | null): string {
  if (!date) return ''
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const TYPE_COLORS: Record<string, string> = {
  paid: 'bg-green-500/15 border-green-500/40 text-green-500',
  hobby: 'bg-blue-500/15 border-blue-500/40 text-blue-500',
  playtest: 'bg-purple-500/15 border-purple-500/40 text-purple-500',
  mentor: 'bg-brackeys-yellow/15 border-brackeys-yellow/40 text-brackeys-yellow',
}

const COMP_TYPE_COLORS: Record<string, string> = {
  hourly: 'bg-green-500/15 border-green-500/40 text-green-500',
  fixed: 'bg-green-500/15 border-green-500/40 text-green-500',
  rev_share: 'bg-green-500/15 border-green-500/40 text-green-500',
  negotiable: 'bg-brackeys-yellow/15 border-brackeys-yellow/40 text-brackeys-yellow',
}

const COMP_TYPE_LABELS: Record<string, string> = {
  hourly: 'HOURLY',
  fixed: 'FIXED',
  rev_share: 'REV SHARE',
  negotiable: 'NEGOTIABLE',
}

export function CollabPostCard({ post, responseCount, roles }: CollabPostCardProps) {
  const isFeatured = !!post.featuredAt
  const isClosed = post.status === 'party_full'

  return (
    <Link
      to="/collab/$postId"
      params={{ postId: String(post.id) }}
      className={cn(
        'block border bg-muted/30 p-3 space-y-2 transition-all hover:bg-muted/40',
        isFeatured ? 'border-brackeys-yellow/60' : 'border-muted',
        isClosed && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-xs font-bold text-foreground uppercase tracking-wider line-clamp-1">
          {post.title}
        </span>
        {isFeatured && (
          <span className="shrink-0 font-mono text-[10px] text-brackeys-yellow tracking-widest uppercase">
            FEATURED
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1">
        <span className={cn('inline-block border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider', TYPE_COLORS[post.type] ?? 'bg-muted/30 border-muted/50 text-muted-foreground')}>
          {post.type}
        </span>
        {post.subtype && (
          <span className="inline-block bg-muted/30 border border-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
            {post.subtype}
          </span>
        )}
        {post.isIndividual && (
          <span className="inline-block bg-primary/15 border border-primary/40 px-1.5 py-0.5 font-mono text-[10px] text-primary uppercase tracking-wider">
            INDIVIDUAL
          </span>
        )}
        {post.compensationType && (
          <span className={cn('inline-block border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider', COMP_TYPE_COLORS[post.compensationType] ?? 'bg-muted/30 border-muted/50 text-muted-foreground')}>
            {COMP_TYPE_LABELS[post.compensationType] ?? post.compensationType}
          </span>
        )}
        {isClosed && (
          <span className="inline-block bg-destructive/15 border border-destructive/40 px-1.5 py-0.5 font-mono text-[10px] text-destructive uppercase tracking-wider">
            CLOSED
          </span>
        )}
      </div>

      {roles && roles.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {roles.slice(0, 3).map((role) => (
            <span key={role.id} className="inline-block bg-primary/15 border border-primary/40 px-1.5 py-0.5 font-mono text-[10px] text-primary uppercase tracking-wider">
              {role.name}
            </span>
          ))}
          {roles.length > 3 && (
            <span className="font-mono text-[10px] text-muted-foreground">+{roles.length - 3}</span>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-muted-foreground">
          {post.teamSize && <>{post.teamSize.toUpperCase()} DEVS &middot; </>}
          {timeAgo(post.createdAt)}
        </span>
        {responseCount !== undefined && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {responseCount} {responseCount === 1 ? 'response' : 'responses'}
          </span>
        )}
      </div>
    </Link>
  )
}
