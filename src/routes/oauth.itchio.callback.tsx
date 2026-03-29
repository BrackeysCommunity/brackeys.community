import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { client } from '@/orpc/client'

export const Route = createFileRoute('/oauth/itchio/callback')({
  component: ItchIoCallbackPage,
})

function ItchIoCallbackPage() {
  const navigate = useNavigate()
  const processed = useRef(false)

  const linkMutation = useMutation({
    mutationFn: (accessToken: string) => client.linkItchIo({ accessToken }),
    onSuccess: (data) => {
      toast.success(`Linked itch.io account: ${data.providerUsername}`)
      navigate({ to: '/profile' })
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to link itch.io account')
      navigate({ to: '/profile' })
    },
  })

  useEffect(() => {
    if (processed.current) return
    processed.current = true

    const hash = window.location.hash.slice(1)
    const params = new URLSearchParams(hash)
    const accessToken = params.get('access_token')

    if (!accessToken) {
      toast.error('No access token received from itch.io')
      navigate({ to: '/profile' })
      return
    }

    linkMutation.mutate(accessToken)
  }, [linkMutation.mutate, navigate])

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center space-y-3">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto" />
        <p className="font-mono text-sm text-muted-foreground">
          Linking your itch.io account...
        </p>
      </div>
    </div>
  )
}
