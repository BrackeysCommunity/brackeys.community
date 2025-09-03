import { router } from '../router';
import { AuthProvider } from './AuthProvider';
import { LayoutProvider } from './LayoutProvider';
import { QueryClientProvider } from './QueryClientProvider';
import { ApolloProvider } from './ApolloProvider';
import { RouterProvider } from '@tanstack/react-router';

export const ContextProviders = () => (
  <QueryClientProvider>
    <AuthProvider>
      <ApolloProvider>
        <LayoutProvider>
          <RouterProvider router={router} />
        </LayoutProvider>
      </ApolloProvider>
    </AuthProvider>
  </QueryClientProvider>
);