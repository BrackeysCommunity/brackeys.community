import { createFileRoute } from '@tanstack/react-router'
import { CommandCenterPage } from '@/components/home/CommandCenterPage'

export const Route = createFileRoute('/command-center')({
  component: CommandCenterPage,
})
