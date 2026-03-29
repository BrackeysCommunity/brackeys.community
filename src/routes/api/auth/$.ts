import { createFileRoute } from '@tanstack/react-router'
import { auth } from '@/lib/auth'

async function handle({ request }: { request: Request }) {
  return auth.handler(request)
}

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      HEAD: handle,
      GET: handle,
      POST: handle,
      PUT: handle,
      PATCH: handle,
      DELETE: handle,
    },
  },
})
