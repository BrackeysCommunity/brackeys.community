import { router } from '../router';
import { AuthProvider } from './AuthProvider';
import { LayoutProvider } from './LayoutProvider';
import { QueryClientProvider } from './QueryClientProvider';
import { RouterProvider } from '@tanstack/react-router';

export const ContextProviders = () => (
  <QueryClientProvider>
    <AuthProvider>
      <LayoutProvider>
        <RouterProvider router={router} />
      </LayoutProvider>
    </AuthProvider>
  </QueryClientProvider>
);
