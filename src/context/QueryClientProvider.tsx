import { useAuth } from '@clerk/tanstack-react-start';
import {
  type MutationFunction,
  QueryClientProvider as Provider,
  QueryClient,
  type QueryFunction,
} from '@tanstack/react-query';
import { type ReactNode, useContext, useEffect, useState } from 'react';
import { AuthContext } from './authContext';

type MutationVariables = {
  url: string;
  options?: RequestInit;
  [key: string]: string | number | boolean | object | undefined;
};

interface QueryContext {
  queryKey: readonly unknown[];
  client: QueryClient;
  signal: AbortSignal;
  meta: Record<string, unknown> | undefined;
  pageParam?: unknown;
  direction?: unknown;
}

type QueryClientProviderProps = {
  children: ReactNode;
};

export const QueryClientProvider = ({ children }: QueryClientProviderProps) => {
  useContext(AuthContext);
  const { getToken } = useAuth();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: 1,
          },
        },
      }),
  );

  useEffect(() => {
    const setupAuthInterceptor = async () => {
      const token = await getToken({ template: 'hasura' });

      const mutationKey = ['defaultMutation'];
      const oldMutateObj = queryClient.getMutationDefaults(mutationKey);
      const oldMutate = oldMutateObj?.mutationFn as
        | MutationFunction<MutationVariables>
        | undefined;
      const oldFetch = queryClient.getDefaultOptions().queries?.queryFn;

      queryClient.setMutationDefaults(mutationKey, {
        mutationFn: async (variables: MutationVariables) => {
          if (oldMutate) {
            return oldMutate(variables);
          }

          const options = variables.options || {};
          const headers = options.headers || {};

          if (token) {
            (headers as Headers).append('Authorization', `Bearer ${token}`);
          }

          options.headers = headers;
          variables.options = options;

          return variables;
        },
      });

      queryClient.setDefaultOptions({
        queries: {
          queryFn: async (context: QueryContext) => {
            if (oldFetch && typeof oldFetch === 'function') {
              return (oldFetch as QueryFunction)(context);
            }

            const url = context.queryKey[0];
            if (typeof url !== 'string') {
              throw new Error('Query key must be a string URL');
            }

            const options: RequestInit = {};
            const headers = new Headers();

            const currentToken = await getToken({ template: 'hasura' });
            if (currentToken) {
              headers.append('Authorization', `Bearer ${currentToken}`);
            }

            options.headers = headers;

            const response = await fetch(url, options);
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }

            return response.json();
          },
        },
      });
    };

    setupAuthInterceptor();
  }, [queryClient, getToken]);

  return <Provider client={queryClient}>{children}</Provider>;
};
