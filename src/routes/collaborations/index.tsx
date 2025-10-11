import { createFileRoute } from '@tanstack/react-router';
import { Collaborations } from '@/pages/Collaborations';

export const Route = createFileRoute('/collaborations/')({
  component: Collaborations,
  head: () => ({
    meta: [{ title: 'Collaborations - Brackeys Community' }],
  }),
});
