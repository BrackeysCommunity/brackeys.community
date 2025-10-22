import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { LoadingFallback } from '@/components/ui';

const Profile = lazy(() =>
  import('@/pages/Profile').then((m) => ({ default: m.Profile })),
);

const ProfileWithSuspense = () => (
  <Suspense fallback={<LoadingFallback message="Loading profile..." />}>
    <Profile />
  </Suspense>
);

export const Route = createFileRoute('/profile')({
  component: ProfileWithSuspense,
  head: () => ({
    meta: [{ title: 'Profile - Brackeys Community' }],
  }),
});
