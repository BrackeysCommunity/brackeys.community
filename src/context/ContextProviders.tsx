import { router } from '../router';
import { ClerkAuthProvider } from './ClerkAuthProvider';
import { LayoutProvider } from './LayoutProvider';
import { QueryClientProvider } from './QueryClientProvider';
import { RouterProvider } from '@tanstack/react-router';

export const ContextProviders = () => (
  <QueryClientProvider>
    <ClerkAuthProvider>
      <LayoutProvider>
        <RouterProvider router={router} />
      </LayoutProvider>
    </ClerkAuthProvider>
  </QueryClientProvider>
);
