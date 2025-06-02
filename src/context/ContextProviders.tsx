import { router } from '../router';
import { AuthProvider } from './AuthProvider';
import { LayoutProvider } from './LayoutProvider';
import { QueryClientProvider } from './QueryClientProvider';
import { RouterProvider } from '@tanstack/react-router';

export const ContextProviders = () => (
  <AuthProvider>
    <QueryClientProvider>
      <LayoutProvider>
        <RouterProvider router={router} />
      </LayoutProvider>
    </QueryClientProvider>
  </AuthProvider>
);