import { createFileRoute } from '@tanstack/react-router'
import { CollabBrowsePage } from '@/components/collab/CollabBrowsePage'

export const Route = createFileRoute('/collab/')({
  component: CollabBrowsePage,
})
