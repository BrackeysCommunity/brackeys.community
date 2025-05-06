import { router } from '../router';
import { AuthProvider } from './AuthProvider';
import { RouterProvider } from '@tanstack/react-router';

export const ContextProviders = () => (
  <AuthProvider>
    <RouterProvider router={router} />
  </AuthProvider>
);