import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { LoadingFallback } from '@/components/ui';

const Collaborations = lazy(() =>
  import('@/pages/Collaborations').then((m) => ({ default: m.Collaborations })),
);

const CollaborationsWithSuspense = () => (
  <Suspense fallback={<LoadingFallback message="Loading collaborations..." />}>
    <Collaborations />
  </Suspense>
);

export const Route = createFileRoute('/collaborations/')({
  component: CollaborationsWithSuspense,
  head: () => ({
    meta: [{ title: 'Collaborations - Brackeys Community' }],
  }),
});
