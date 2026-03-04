import { useQuery } from '@tanstack/react-query'
import { usePageSidebar } from '@/lib/hooks/use-page-layout'
import { orpc } from '@/orpc/client'
import { Route } from '@/routes/collab.$postId'
import { CollabPostSidebar } from './CollabPostSidebar'

const TYPE_COLORS: Record<string, string> = {
  paid: 'text-green-500',
  hobby: 'text-blue-500',
  playtest: 'text-purple-500',
  mentor: 'text-brackeys-yellow',
}

const COMP_TYPE_LABELS: Record<string, string> = {
  hourly: 'Hourly',
  fixed: 'Fixed Price',
  rev_share: 'Revenue Share',
  negotiable: 'Negotiable',
}

export function CollabPostPage() {
  const { postId } = Route.useParams()
  const numericId = Number(postId)

  const { data: post, isLoading } = useQuery({
    ...orpc.getPost.queryOptions({ input: { postId: numericId } }),
    staleTime: 30 * 1000,
  })

  usePageSidebar(
    <CollabPostSidebar post={post ?? null} isLoading={isLoading} postId={numericId} />,
  )

  const statusLabel = post?.status === 'party_full' ? 'CLOSED' : 'RECRUITING'
  const typeColor = TYPE_COLORS[post?.type ?? ''] ?? 'text-muted-foreground'

  // Parse feedback types for playtest posts
  let feedbackTypes: string[] = []
  if (post?.type === 'playtest' && post.experience) {
    try {
      feedbackTypes = JSON.parse(post.experience)
      if (!Array.isArray(feedbackTypes)) feedbackTypes = []
    } catch {
      feedbackTypes = []
    }
  }

  return (
    <>
      {/* Status bar */}
      <div className="mb-4 flex items-center gap-2 font-mono text-xs tracking-widest text-muted-foreground">
        <span className="text-primary">{'>'}</span>
        {isLoading ? 'LOADING...' : post ? 'POST LOADED' : 'NOT FOUND'}
        {post && (
          <>
            <span className="mx-2 text-primary">{'//'}</span>
            <span className={typeColor}>{post.type?.toUpperCase()}</span>
            {post.isIndividual && (
              <>
                <span className="mx-2 text-primary">{'//'}</span>
                <span className="text-primary">INDIVIDUAL</span>
              </>
            )}
            <span className="mx-2 text-primary">{'//'}</span>
            <span className={post.status === 'party_full' ? 'text-destructive' : 'text-green-500'}>
              {statusLabel}
            </span>
          </>
        )}
      </div>

      {/* Heading block */}
      <div className="flex flex-col justify-center">
          <h1 className="font-mono font-bold text-[clamp(2rem,5vw,6rem)] leading-[0.85] tracking-tighter text-foreground">
          {isLoading ? (
            <span className="animate-pulse text-muted-foreground">...</span>
          ) : post ? (
            (() => {
              const words = post.title.toUpperCase().split(' ')
              if (words.length <= 1) {
                return (
                  <>
                    {words[0]}
                    <br />
                    <span className="text-transparent [-webkit-text-stroke:1px_var(--color-primary)] hover:text-primary transition-colors duration-300">
                      POST.
                    </span>
                  </>
                )
              }
              const mid = Math.ceil(words.length / 2)
              const line1 = words.slice(0, mid).join(' ')
              const line2 = words.slice(mid).join(' ')
              return (
                <>
                  {line1}
                  <br />
                  <span className="text-transparent [-webkit-text-stroke:1px_var(--color-primary)] hover:text-primary transition-colors duration-300">
                    {line2 || 'POST.'}
                  </span>
                </>
              )
            })()
          ) : (
            <>
              NOT
              <br />
              <span className="text-transparent [-webkit-text-stroke:1px_var(--color-primary)]">
                FOUND.
              </span>
            </>
          )}
        </h1>
        {post && (
          <p className="mt-8 max-w-xl font-sans text-lg text-muted-foreground lg:text-xl whitespace-pre-wrap">
            {post.description}
          </p>
        )}
        {!isLoading && !post && (
          <p className="mt-8 max-w-xl font-sans text-lg text-muted-foreground lg:text-xl">
            This post does not exist or has been deleted.
          </p>
        )}
      </div>

      {/* Post details */}
      {post && (
        <div className="my-6 sm:mt-12 space-y-4">
          {/* Project section */}
          {(post.projectName || post.teamSize || post.projectLength || post.platforms?.length) && (
            <div className="space-y-2">
              <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase">// Project</span>
              {post.projectName && (
                <div className="flex items-center gap-3 font-mono text-sm text-muted-foreground">
                  <span className="text-primary text-xs">PROJECT</span>
                  <span className="text-foreground">{post.projectName}</span>
                </div>
              )}
              {post.platforms && post.platforms.length > 0 && (
                <div className="flex items-center gap-3 font-mono text-sm">
                  <span className="text-primary text-xs">PLATFORMS</span>
                  <div className="flex flex-wrap gap-1">
                    {post.platforms.map((p) => (
                      <span key={p} className="inline-block bg-primary/10 border border-primary/30 px-1.5 py-0.5 font-mono text-[10px] text-primary uppercase tracking-wider">
                        {p}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {post.teamSize && (
                <div className="flex items-center gap-3 font-mono text-sm text-muted-foreground">
                  <span className="text-primary text-xs">TEAM</span>
                  <span className="text-foreground">{post.teamSize}</span>
                </div>
              )}
              {post.projectLength && (
                <div className="flex items-center gap-3 font-mono text-sm text-muted-foreground">
                  <span className="text-primary text-xs">{post.type === 'playtest' ? 'PLAY TIME' : 'LENGTH'}</span>
                  <span className="text-foreground">{post.projectLength}</span>
                </div>
              )}
            </div>
          )}

          {/* Compensation section */}
          {(post.compensationType || post.compensation) && (
            <div className="space-y-2">
              <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase">// Compensation</span>
              {post.compensationType && (
                <div className="flex items-center gap-3 font-mono text-sm text-muted-foreground">
                  <span className="text-green-500 text-xs">TYPE</span>
                  <span className="inline-block bg-green-500/10 border border-green-500/30 px-1.5 py-0.5 font-mono text-[10px] text-green-500 uppercase tracking-wider">
                    {COMP_TYPE_LABELS[post.compensationType] ?? post.compensationType}
                  </span>
                </div>
              )}
              {post.compensation && (
                <div className="flex items-center gap-3 font-mono text-sm text-muted-foreground">
                  <span className="text-green-500 text-xs">COMP</span>
                  <span className="text-foreground">{post.compensation}</span>
                </div>
              )}
            </div>
          )}

          {/* Experience section */}
          {post.experienceLevel && (
            <div className="flex items-center gap-3 font-mono text-sm text-muted-foreground">
              <span className="text-primary text-xs">EXP</span>
              <span className="text-foreground capitalize">{post.experienceLevel}</span>
            </div>
          )}

          {/* Playtest-specific: feedback types */}
          {feedbackTypes.length > 0 && (
            <div className="space-y-2">
              <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase">// Feedback Wanted</span>
              <div className="flex flex-wrap gap-1">
                {feedbackTypes.map((ft) => (
                  <span key={ft} className="inline-block bg-purple-500/10 border border-purple-500/30 px-1.5 py-0.5 font-mono text-[10px] text-purple-500 uppercase tracking-wider">
                    {ft}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Playtest game link */}
          {post.type === 'playtest' && post.portfolioUrl && (
            <div className="flex items-center gap-3 font-mono text-sm">
              <span className="text-purple-500 text-xs">GAME</span>
              <a href={post.portfolioUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">
                {post.portfolioUrl}
              </a>
            </div>
          )}

          {/* Individual offering: about the author */}
          {post.isIndividual && post.author && (
            <div className="space-y-2">
              <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase">// About the Author</span>
              <div className="border border-muted/30 bg-muted/10 p-3 space-y-2">
                <div className="flex items-center gap-3">
                  {post.author.avatarUrl ? (
                    <img src={post.author.avatarUrl} alt="" className="w-10 h-10 rounded-full border border-muted/30" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-muted/30 border border-muted/30" />
                  )}
                  <div>
                    <p className="font-mono text-sm font-bold text-foreground">{post.author.discordUsername ?? 'Unknown'}</p>
                    {post.author.tagline && (
                      <p className="font-mono text-xs text-muted-foreground">{post.author.tagline}</p>
                    )}
                  </div>
                </div>
                {post.author.skills && post.author.skills.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {post.author.skills.map((skill: { id: number; name: string }) => (
                      <span key={skill.id} className="bg-primary/10 border border-primary/30 px-1.5 py-0.5 font-mono text-[10px] text-primary uppercase tracking-wider">
                        {skill.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}
