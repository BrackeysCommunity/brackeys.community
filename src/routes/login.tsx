import { createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { LoadingFallback } from '@/components/ui';

const Login = lazy(() =>
  import('@/pages/Login').then((m) => ({ default: m.Login })),
);

const LoginWithSuspense = () => (
  <Suspense fallback={<LoadingFallback />}>
    <Login />
  </Suspense>
);

export const Route = createFileRoute('/login')({
  component: LoginWithSuspense,
  head: () => ({
    meta: [{ title: 'Login - Brackeys Community' }],
  }),
});
