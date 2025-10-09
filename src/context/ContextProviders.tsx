import { router } from '../router';
import { ClerkAuthProvider } from './ClerkAuthProvider';
import { LayoutProvider } from './LayoutProvider';
import { QueryClientProvider } from './QueryClientProvider';
import { RouterProvider } from '@tanstack/react-router';
import { ClerkProvider } from '@clerk/clerk-react';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
  throw new Error('Missing Clerk Publishable Key');
}

export const ContextProviders = () => (
  <ClerkProvider
    publishableKey={PUBLISHABLE_KEY}
    appearance={{
      variables: { colorPrimary: '#10b981' },
    }}
    afterSignOutUrl="/"
    signInFallbackRedirectUrl="/dashboard"
    signUpFallbackRedirectUrl="/auth/entry"
    signInForceRedirectUrl="/auth/entry"
    signUpForceRedirectUrl="/auth/entry"
  >
    <QueryClientProvider>
      <ClerkAuthProvider>
        <LayoutProvider>
          <RouterProvider router={router} />
        </LayoutProvider>
      </ClerkAuthProvider>
    </QueryClientProvider>
  </ClerkProvider>
);
