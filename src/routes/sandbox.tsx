import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { LoadingFallback } from '@/components/ui';

const Sandbox = lazy(() =>
  import('@/pages/Sandbox').then((m) => ({ default: m.Sandbox })),
);

const SandboxWithSuspense = () => (
  <Suspense fallback={<LoadingFallback message="Loading sandbox..." />}>
    <Sandbox />
  </Suspense>
);

export const Route = createFileRoute('/sandbox')({
  component: SandboxWithSuspense,
  head: () => ({
    meta: [{ title: 'Sandbox - Brackeys Community' }],
  }),
});
