import { createFileRoute } from '@tanstack/react-router'
import { ProfileBuilderPage } from '@/components/profile/ProfileBuilderPage'

export const Route = createFileRoute('/profile/')({
  component: ProfileBuilderPage,
})
