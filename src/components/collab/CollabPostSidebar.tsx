import {
  Delete02Icon,
  Login01Icon,
  Flag01Icon,
  StarIcon,
  Tick01Icon,
  Cancel01Icon,
  LinkSquare01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useStore } from '@tanstack/react-store'
import { motion } from 'framer-motion'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react'
import { useState } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { authStore } from '@/lib/auth-store'
import { useMagnetic } from '@/lib/hooks/use-cursor'
import { cn } from '@/lib/utils'
import { client, orpc } from '@/orpc/client'

const NOTCH_SIZE = 22
const notchClip = `polygon(0 0, calc(100% - ${NOTCH_SIZE}px) 0, 100% ${NOTCH_SIZE}px, 100% 100%, 0 100%)`
const notchClipInner = `polygon(0 0, calc(100% - ${NOTCH_SIZE - 2}px) 0, 100% ${NOTCH_SIZE - 2}px, 100% 100%, 0 100%)`
const springTransition = { type: 'spring', stiffness: 1000, damping: 30, mass: 0.1 } as const

const TYPE_BADGE_COLORS: Record<string, string> = {
  paid: 'bg-green-500/10 border-green-500/30 text-green-500',
  hobby: 'bg-blue-500/10 border-blue-500/30 text-blue-500',
  playtest: 'bg-purple-500/10 border-purple-500/30 text-purple-500',
  mentor: 'bg-brackeys-yellow/10 border-brackeys-yellow/30 text-brackeys-yellow',
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-2 border-b border-muted/30">
      <span className="font-mono text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase">
        {'// '}{children}
      </span>
    </div>
  )
}

function MagneticFooterButton({
  onClick,
  children,
  className,
  disabled,
}: {
  onClick: () => void
  children: React.ReactNode
  className?: string
  disabled?: boolean
}) {
  const { ref, position } = useMagnetic(0.25)
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
  )
}

type PostData = {
  id: number
  authorId: string
  type: string
  subtype: string | null
  title: string
  description: string
  status: string
  featuredAt: string | Date | null
  createdAt: string | Date | null
  updatedAt: string | Date | null
  contactMethod: string | null
  contactType: string | null
  compensationType: string | null
  compensation: string | null
  teamSize: string | null
  experienceLevel: string | null
  isIndividual: boolean | null
  portfolioUrl: string | null
  roles?: { id: number; name: string; category: string | null }[]
  images?: { id: number; url: string; alt: string | null }[]
  responseCount?: number
  responses?: {
    id: number
    responderId: string
    message: string
    portfolioUrl: string | null
    status: string
    createdAt: string | Date | null
  }[] | null
  isOwner?: boolean
  author?: {
    avatarUrl: string | null
    discordUsername: string | null
    tagline: string | null
    bio: string | null
    skills: { id: number; name: string }[]
  } | null
}

interface CollabPostSidebarProps {
  post: PostData | null
  isLoading: boolean
  postId: number
}

function ResponseForm({ postId }: { postId: number }) {
  const [message, setMessage] = useState('')
  const [portfolioUrl, setPortfolioUrl] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const queryClient = useQueryClient()

  const respondMutation = useMutation({
    mutationFn: () =>
      client.respondToPost({
        postId,
        message,
        portfolioUrl: portfolioUrl || undefined,
      }),
    onSuccess: () => {
      setSuccess(true)
      setMessage('')
      setPortfolioUrl('')
      queryClient.invalidateQueries({ queryKey: orpc.getPost.queryOptions({ input: { postId } }).queryKey })
    },
    onError: (err: Error) => setError(err.message),
  })

  if (success) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="font-mono text-xs text-green-500 tracking-widest uppercase">Response sent!</p>
      </div>
    )
  }

  return (
    <div className="px-4 py-3 space-y-3">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Write your application message..."
        rows={4}
        maxLength={2000}
        className="w-full bg-muted/20 border border-muted/30 px-2.5 py-1.5 font-mono text-xs text-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50 resize-none transition-colors"
      />
      <input
        type="text"
        value={portfolioUrl}
        onChange={(e) => setPortfolioUrl(e.target.value)}
        placeholder="Portfolio URL (optional)"
        className="w-full bg-muted/20 border border-muted/30 px-2.5 py-1.5 font-mono text-xs text-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50 transition-colors"
      />
      {error && <p className="font-mono text-[10px] text-destructive">{error}</p>}
      <button
        type="button"
        onClick={() => respondMutation.mutate()}
        disabled={!message.trim() || respondMutation.isPending}
        className="w-full bg-primary/20 border border-primary/40 py-2 font-mono text-[10px] text-primary uppercase tracking-widest hover:bg-primary/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {respondMutation.isPending ? 'SENDING...' : 'SEND RESPONSE'}
      </button>
    </div>
  )
}

function ResponseList({ responses, postId }: { responses: NonNullable<PostData['responses']>; postId: number }) {
  const queryClient = useQueryClient()

  const updateStatusMutation = useMutation({
    mutationFn: ({ responseId, status }: { responseId: number; status: 'accepted' | 'declined' }) =>
      client.updateResponseStatus({ responseId, status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.getPost.queryOptions({ input: { postId } }).queryKey })
    },
  })

  return (
    <div className="space-y-2">
      {responses.map((resp) => (
        <div key={resp.id} className="border border-muted/30 bg-muted/10 p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <span className="font-mono text-[10px] text-muted-foreground/50">
              {resp.responderId.slice(0, 8)}...
            </span>
            <span className={cn(
              'font-mono text-[8px] uppercase tracking-wider px-1.5 py-0.5 border',
              resp.status === 'accepted' ? 'bg-green-500/10 border-green-500/30 text-green-500' :
              resp.status === 'declined' ? 'bg-destructive/10 border-destructive/30 text-destructive' :
              'bg-brackeys-yellow/10 border-brackeys-yellow/30 text-brackeys-yellow',
            )}>
              {resp.status}
            </span>
          </div>
          <p className="font-mono text-[10px] text-foreground whitespace-pre-wrap">{resp.message}</p>
          {resp.portfolioUrl && (
            <a
              href={resp.portfolioUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[9px] text-primary hover:underline"
            >
              <HugeiconsIcon icon={LinkSquare01Icon} size={10} />
              Portfolio
            </a>
          )}
          {resp.status === 'pending' && (
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => updateStatusMutation.mutate({ responseId: resp.id, status: 'accepted' })}
                className="flex-1 bg-green-500/10 border border-green-500/30 py-1 font-mono text-[9px] text-green-500 uppercase tracking-wider hover:bg-green-500/20 transition-colors"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => updateStatusMutation.mutate({ responseId: resp.id, status: 'declined' })}
                className="flex-1 bg-destructive/10 border border-destructive/30 py-1 font-mono text-[9px] text-destructive uppercase tracking-wider hover:bg-destructive/20 transition-colors"
              >
                Decline
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export function CollabPostSidebar({ post, isLoading, postId }: CollabPostSidebarProps) {
  const { session, isPending: authPending } = useStore(authStore)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showReport, setShowReport] = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [reportSuccess, setReportSuccess] = useState(false)

  const isOwner = post?.isOwner ?? false
  const isAuthenticated = !!session?.user

  const closeMutation = useMutation({
    mutationFn: () => client.closePost({ postId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.getPost.queryOptions({ input: { postId } }).queryKey }),
  })

  const reopenMutation = useMutation({
    mutationFn: () => client.reopenPost({ postId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.getPost.queryOptions({ input: { postId } }).queryKey }),
  })

  const deleteMutation = useMutation({
    mutationFn: () => client.deletePost({ postId }),
    onSuccess: () => navigate({ to: '/collab' }),
  })

  const featureMutation = useMutation({
    mutationFn: (featured: boolean) => client.featurePost({ postId, featured }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.getPost.queryOptions({ input: { postId } }).queryKey }),
  })

  const reportMutation = useMutation({
    mutationFn: () => client.reportPost({ postId, reason: reportReason }),
    onSuccess: () => {
      setReportSuccess(true)
      setShowReport(false)
      setReportReason('')
    },
  })

  return (
    <div className="flex-1 min-h-0 flex p-6 selection:bg-primary selection:text-white">
      <div
        className="flex-1 min-h-0 min-w-0 max-h-[800px] my-auto bg-muted/60 pointer-events-auto"
        style={{ clipPath: notchClip, padding: '2px' }}
      >
        <div
          className="flex flex-col h-full bg-background/90 backdrop-blur-md relative"
          style={{ clipPath: notchClipInner }}
        >
          {/* Corner decorators */}
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

          {/* Header bar */}
          <div className="flex items-center justify-between border-b border-muted/60 bg-card/40 px-4 py-2.5 shrink-0">
            <span className="font-mono text-xs font-bold tracking-widest text-muted-foreground uppercase">
              COLLAB // POST
            </span>
            {post && (
              <span className={cn(
                'font-mono text-[10px] font-bold tracking-widest uppercase',
                post.status === 'party_full' ? 'text-destructive' : 'text-green-500',
              )}>
                {post.status === 'party_full' ? 'CLOSED' : 'OPEN'}
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <span className="font-mono text-xs text-muted-foreground animate-pulse tracking-widest uppercase">
                Loading post data...
              </span>
            </div>
          ) : !post ? (
            <div className="flex-1 flex items-center justify-center">
              <span className="font-mono text-xs text-muted-foreground tracking-widest uppercase">
                Post not found
              </span>
            </div>
          ) : (
            <>
              <OverlayScrollbarsComponent
                element="div"
                className="flex-1 min-h-0"
                options={{
                  scrollbars: {
                    theme: 'os-theme-dark',
                    autoHide: 'scroll',
                    autoHideDelay: 800,
                  },
                }}
              >
                {/* Metadata */}
                <SectionHeader>Info</SectionHeader>
                <div className="px-4 py-3 border-b border-muted/30 space-y-2">
                  <div className="flex flex-wrap gap-1">
                    <span className={cn('border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider', TYPE_BADGE_COLORS[post.type] ?? 'bg-muted/20 border-muted/40 text-muted-foreground')}>
                      {post.type}
                    </span>
                    {post.subtype && (
                      <span className="bg-muted/20 border border-muted/40 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground uppercase tracking-wider">
                        {post.subtype}
                      </span>
                    )}
                    {post.isIndividual && (
                      <span className="bg-primary/10 border border-primary/30 px-1.5 py-0.5 font-mono text-[9px] text-primary uppercase tracking-wider">
                        INDIVIDUAL
                      </span>
                    )}
                    {post.featuredAt && (
                      <span className="bg-brackeys-yellow/10 border border-brackeys-yellow/30 px-1.5 py-0.5 font-mono text-[9px] text-brackeys-yellow uppercase tracking-wider">
                        FEATURED
                      </span>
                    )}
                  </div>
                  <p className="font-mono text-[10px] text-muted-foreground/50">
                    Author: {post.authorId.slice(0, 12)}...
                  </p>
                  {post.createdAt && (
                    <p className="font-mono text-[10px] text-muted-foreground/50">
                      Posted: {new Date(post.createdAt).toLocaleDateString()}
                    </p>
                  )}
                </div>

                {/* Contact */}
                {post.isIndividual && post.author ? (
                  <>
                    <SectionHeader>Contact</SectionHeader>
                    <div className="px-4 py-3 border-b border-muted/30 space-y-1">
                      <p className="font-mono text-[10px] text-muted-foreground">
                        <span className="text-primary uppercase">Discord DM</span>
                      </p>
                      <p className="font-mono text-[10px] text-foreground">
                        @{post.author.discordUsername}
                      </p>
                    </div>
                  </>
                ) : (post.contactType || post.contactMethod) ? (
                  <>
                    <SectionHeader>Contact</SectionHeader>
                    <div className="px-4 py-3 border-b border-muted/30 space-y-1">
                      {post.contactType && (
                        <p className="font-mono text-[10px] text-muted-foreground">
                          <span className="text-primary uppercase">
                            {post.contactType === 'discord_dm' ? 'Discord DM' :
                             post.contactType === 'discord_server' ? 'Discord Server' :
                             post.contactType === 'email' ? 'Email' : 'Other'}
                          </span>
                        </p>
                      )}
                      {post.contactMethod && (
                        <p className="font-mono text-[10px] text-foreground">{post.contactMethod}</p>
                      )}
                    </div>
                  </>
                ) : null}

                {/* Portfolio link (non-playtest) */}
                {post.portfolioUrl && post.type !== 'playtest' && (
                  <div className="px-4 py-2 border-b border-muted/30">
                    <a
                      href={post.portfolioUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-[10px] text-primary hover:underline"
                    >
                      <HugeiconsIcon icon={LinkSquare01Icon} size={10} />
                      Portfolio
                    </a>
                  </div>
                )}

                {/* Individual offering: author profile preview */}
                {post.isIndividual && post.author && (
                  <>
                    <SectionHeader>Author Profile</SectionHeader>
                    <div className="px-4 py-3 border-b border-muted/30 space-y-2">
                      <div className="flex items-center gap-3">
                        {post.author.avatarUrl ? (
                          <img src={post.author.avatarUrl} alt="" className="w-8 h-8 rounded-full border border-muted/30" />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-muted/30 border border-muted/30" />
                        )}
                        <div>
                          <p className="font-mono text-xs font-bold text-foreground">{post.author.discordUsername ?? 'Unknown'}</p>
                          {post.author.tagline && (
                            <p className="font-mono text-[9px] text-muted-foreground">{post.author.tagline}</p>
                          )}
                        </div>
                      </div>
                      {post.author.skills && post.author.skills.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {post.author.skills.slice(0, 6).map((skill) => (
                            <span key={skill.id} className="bg-primary/10 border border-primary/30 px-1.5 py-0.5 font-mono text-[8px] text-primary uppercase tracking-wider">
                              {skill.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Roles */}
                {post.roles && post.roles.length > 0 && (
                  <>
                    <SectionHeader>Roles Needed</SectionHeader>
                    <div className="px-4 py-3 border-b border-muted/30 flex flex-wrap gap-1">
                      {post.roles.map((role) => (
                        <span key={role.id} className="bg-primary/10 border border-primary/30 px-2 py-0.5 font-mono text-[10px] text-primary uppercase tracking-wider">
                          {role.name}
                        </span>
                      ))}
                    </div>
                  </>
                )}

                {/* Images */}
                {post.images && post.images.length > 0 && (
                  <>
                    <SectionHeader>Images</SectionHeader>
                    <div className="px-4 py-3 border-b border-muted/30 space-y-2">
                      {post.images.map((img) => (
                        <img
                          key={img.id}
                          src={img.url}
                          alt={img.alt ?? 'Post image'}
                          className="w-full h-32 object-cover border border-muted/20"
                        />
                      ))}
                    </div>
                  </>
                )}

                {/* Owner actions */}
                {isOwner && (
                  <>
                    <SectionHeader>Actions</SectionHeader>
                    <div className="px-4 py-3 border-b border-muted/30 space-y-2">
                      {post.status === 'recruiting' ? (
                        <button
                          type="button"
                          onClick={() => closeMutation.mutate()}
                          disabled={closeMutation.isPending}
                          className="w-full bg-brackeys-yellow/10 border border-brackeys-yellow/30 py-1.5 font-mono text-[10px] text-brackeys-yellow uppercase tracking-widest hover:bg-brackeys-yellow/20 transition-colors disabled:opacity-30"
                        >
                          <HugeiconsIcon icon={Cancel01Icon} size={10} className="inline mr-1" />
                          Close Post
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => reopenMutation.mutate()}
                          disabled={reopenMutation.isPending}
                          className="w-full bg-green-500/10 border border-green-500/30 py-1.5 font-mono text-[10px] text-green-500 uppercase tracking-widest hover:bg-green-500/20 transition-colors disabled:opacity-30"
                        >
                          <HugeiconsIcon icon={Tick01Icon} size={10} className="inline mr-1" />
                          Reopen Post
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm('Are you sure you want to delete this post?')) {
                            deleteMutation.mutate()
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        className="w-full bg-destructive/10 border border-destructive/30 py-1.5 font-mono text-[10px] text-destructive uppercase tracking-widest hover:bg-destructive/20 transition-colors disabled:opacity-30"
                      >
                        <HugeiconsIcon icon={Delete02Icon} size={10} className="inline mr-1" />
                        Delete Post
                      </button>
                    </div>
                  </>
                )}

                {/* Staff actions -- only visible if backend granted response access (owner or staff) */}
                {!isOwner && post.responses && (
                  <>
                    <SectionHeader>Staff</SectionHeader>
                    <div className="px-4 py-3 border-b border-muted/30 space-y-2">
                      <button
                        type="button"
                        onClick={() => featureMutation.mutate(!post.featuredAt)}
                        disabled={featureMutation.isPending}
                        className="w-full bg-brackeys-yellow/10 border border-brackeys-yellow/30 py-1.5 font-mono text-[10px] text-brackeys-yellow uppercase tracking-widest hover:bg-brackeys-yellow/20 transition-colors disabled:opacity-30"
                      >
                        <HugeiconsIcon icon={StarIcon} size={10} className="inline mr-1" />
                        {post.featuredAt ? 'Unfeature' : 'Feature'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm('Are you sure you want to delete this post?')) {
                            deleteMutation.mutate()
                          }
                        }}
                        disabled={deleteMutation.isPending}
                        className="w-full bg-destructive/10 border border-destructive/30 py-1.5 font-mono text-[10px] text-destructive uppercase tracking-widest hover:bg-destructive/20 transition-colors disabled:opacity-30"
                      >
                        <HugeiconsIcon icon={Delete02Icon} size={10} className="inline mr-1" />
                        Delete Post
                      </button>
                    </div>
                  </>
                )}

                {/* Response section */}
                {isOwner && post.responses ? (
                  <>
                    <SectionHeader>Responses ({post.responses.length})</SectionHeader>
                    <div className="px-4 py-3 border-b border-muted/30">
                      {post.responses.length > 0 ? (
                        <ResponseList responses={post.responses} postId={postId} />
                      ) : (
                        <p className="font-mono text-[10px] text-muted-foreground/50 tracking-widest uppercase text-center py-4">
                          No responses yet
                        </p>
                      )}
                    </div>
                  </>
                ) : isAuthenticated && !isOwner && post.status === 'recruiting' ? (
                  <>
                    <SectionHeader>Apply</SectionHeader>
                    <ResponseForm postId={postId} />
                  </>
                ) : !isAuthenticated && !authPending ? (
                  <>
                    <SectionHeader>Respond</SectionHeader>
                    <div className="px-4 py-6 text-center space-y-3">
                      <p className="font-mono text-xs text-muted-foreground">Sign in to respond to this post</p>
                      <button
                        type="button"
                        onClick={() => {
                          import('@/lib/auth-client').then(({ authClient }) =>
                            authClient.signIn.social({ provider: 'discord' }),
                          )
                        }}
                        className={cn(
                          buttonVariants({ variant: 'outline', size: 'sm' }),
                          'border-primary/60 text-primary hover:bg-primary/10 hover:border-primary font-mono text-[10px] font-bold tracking-widest uppercase gap-2',
                        )}
                      >
                        <HugeiconsIcon icon={Login01Icon} size={13} />
                        Sign In
                      </button>
                    </div>
                  </>
                ) : null}

                {/* Report */}
                {isAuthenticated && !isOwner && (
                  <>
                    <SectionHeader>Report</SectionHeader>
                    <div className="px-4 py-3 space-y-2">
                      {reportSuccess ? (
                        <p className="font-mono text-[10px] text-green-500 tracking-widest uppercase text-center py-2">
                          Report submitted
                        </p>
                      ) : showReport ? (
                        <>
                          <textarea
                            value={reportReason}
                            onChange={(e) => setReportReason(e.target.value)}
                            placeholder="Describe the issue..."
                            rows={3}
                            maxLength={1000}
                            className="w-full bg-muted/20 border border-muted/30 px-2.5 py-1.5 font-mono text-xs text-foreground placeholder-muted-foreground/30 outline-none focus:border-primary/50 resize-none transition-colors"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => reportMutation.mutate()}
                              disabled={!reportReason.trim() || reportMutation.isPending}
                              className="flex-1 bg-destructive/10 border border-destructive/30 py-1 font-mono text-[9px] text-destructive uppercase tracking-wider hover:bg-destructive/20 transition-colors disabled:opacity-30"
                            >
                              Submit
                            </button>
                            <button
                              type="button"
                              onClick={() => { setShowReport(false); setReportReason('') }}
                              className="flex-1 border border-muted/30 py-1 font-mono text-[9px] text-muted-foreground uppercase tracking-wider hover:border-muted/60 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setShowReport(true)}
                          className="w-full border border-dashed border-muted/40 py-2 font-mono text-[10px] text-muted-foreground hover:border-destructive/50 hover:text-destructive transition-colors uppercase tracking-widest"
                        >
                          <HugeiconsIcon icon={Flag01Icon} size={10} className="inline mr-1" />
                          Report this post
                        </button>
                      )}
                    </div>
                  </>
                )}
              </OverlayScrollbarsComponent>

              {/* Footer */}
              <div className="border-t border-muted/60 bg-card/30 px-6 py-4 flex gap-4 shrink-0">
                <MagneticFooterButton
                  onClick={() => navigate({ to: '/collab' })}
                  className={cn(
                    buttonVariants({ variant: 'outline', size: 'sm' }),
                    'w-full border-muted/40 text-muted-foreground hover:bg-muted/10 hover:border-muted font-mono text-[10px] font-bold tracking-widest uppercase justify-center',
                  )}
                >
                  Back to Browse
                </MagneticFooterButton>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
