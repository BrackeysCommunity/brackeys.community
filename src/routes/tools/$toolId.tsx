import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { LoadingFallback } from '@/components/ui';

const ToolEmbed = lazy(() =>
  import('@/pages/ToolEmbed').then((m) => ({ default: m.ToolEmbed })),
);

const ToolEmbedWithSuspense = () => (
  <Suspense fallback={<LoadingFallback message="Loading tool..." />}>
    <ToolEmbed />
  </Suspense>
);

export const Route = createFileRoute('/tools/$toolId')({
  component: ToolEmbedWithSuspense,
});
