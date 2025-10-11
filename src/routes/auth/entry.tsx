import { createFileRoute } from '@tanstack/react-router';
import { AuthEntry } from '@/pages/AuthEntry';

export const Route = createFileRoute('/auth/entry')({
  component: AuthEntry,
  head: () => ({
    meta: [{ title: 'Authenticating - Brackeys Community' }],
  }),
});
