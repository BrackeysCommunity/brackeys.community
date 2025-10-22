import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { LoadingFallback } from '@/components/ui';

const Snake = lazy(() =>
  import('@/components/games/snake/Snake').then((m) => ({ default: m.Snake })),
);

const SnakeWithSuspense = () => (
  <Suspense fallback={<LoadingFallback message="Loading game..." />}>
    <Snake />
  </Suspense>
);

export const Route = createFileRoute('/games/snake')({
  component: SnakeWithSuspense,
  head: () => ({
    meta: [{ title: 'Snake Game - Brackeys Community' }],
  }),
});
