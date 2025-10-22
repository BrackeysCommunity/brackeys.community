import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { LoadingFallback } from '@/components/ui';

const CollaborationDetail = lazy(() =>
  import('@/pages/CollaborationDetail').then((m) => ({
    default: m.CollaborationDetail,
  })),
);

const CollaborationDetailWithSuspense = () => (
  <Suspense fallback={<LoadingFallback message="Loading collaboration..." />}>
    <CollaborationDetail />
  </Suspense>
);

export const Route = createFileRoute('/collaborations/$postId')({
  component: CollaborationDetailWithSuspense,
});
