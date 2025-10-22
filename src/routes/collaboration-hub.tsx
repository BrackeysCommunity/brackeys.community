import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { LoadingFallback } from '@/components/ui';

const CollaborationHub = lazy(() =>
  import('@/pages/CollaborationHub').then((m) => ({
    default: m.CollaborationHub,
  })),
);

const CollaborationHubWithSuspense = () => (
  <Suspense
    fallback={<LoadingFallback message="Loading collaboration hub..." />}
  >
    <CollaborationHub />
  </Suspense>
);

export const Route = createFileRoute('/collaboration-hub')({
  component: CollaborationHubWithSuspense,
  head: () => ({
    meta: [{ title: 'Collaboration Hub - Brackeys Community' }],
  }),
});
