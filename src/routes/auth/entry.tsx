import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { LoadingFallback } from '@/components/ui';

const AuthEntry = lazy(() =>
  import('@/pages/AuthEntry').then((m) => ({ default: m.AuthEntry })),
);

const AuthEntryWithSuspense = () => (
  <Suspense fallback={<LoadingFallback message="Authenticating..." />}>
    <AuthEntry />
  </Suspense>
);

export const Route = createFileRoute('/auth/entry')({
  component: AuthEntryWithSuspense,
  head: () => ({
    meta: [{ title: 'Authenticating - Brackeys Community' }],
  }),
});
