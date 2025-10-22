import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { LoadingFallback } from '@/components/ui';

const Resources = lazy(() =>
  import('@/pages/Resources').then((m) => ({ default: m.Resources })),
);

const ResourcesWithSuspense = () => (
  <Suspense fallback={<LoadingFallback message="Loading resources..." />}>
    <Resources />
  </Suspense>
);

export const Route = createFileRoute('/resources')({
  component: ResourcesWithSuspense,
  head: () => ({
    meta: [{ title: 'Games & Tools - Brackeys Community' }],
  }),
});
