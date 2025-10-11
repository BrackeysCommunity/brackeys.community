import { createFileRoute } from '@tanstack/react-router';
import { CollaborationHub } from '@/pages/CollaborationHub';

export const Route = createFileRoute('/collaboration-hub')({
  component: CollaborationHub,
  head: () => ({
    meta: [{ title: 'Collaboration Hub - Brackeys Community' }],
  }),
});
