import { createFileRoute } from '@tanstack/react-router'
import { ProfileViewPage } from '@/components/profile/ProfileViewPage'

export const Route = createFileRoute('/profile/$userId')({
  component: ProfileViewPage,
})
