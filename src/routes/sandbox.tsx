import { createFileRoute } from '@tanstack/react-router';
import { Sandbox } from '@/pages/Sandbox';

export const Route = createFileRoute('/sandbox')({
  component: Sandbox,
  head: () => ({
    meta: [{ title: 'Sandbox - Brackeys Community' }],
  }),
});
