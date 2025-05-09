import { router } from '../router';
import { AuthProvider } from './AuthProvider';
import { QueryClientProvider } from './QueryClientProvider';
import { RouterProvider } from '@tanstack/react-router';

export const ContextProviders = () => (
  <AuthProvider>
    <QueryClientProvider>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </AuthProvider>
);