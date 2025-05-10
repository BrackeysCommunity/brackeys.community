import { ReactNode, useEffect, useState } from "react";
import { QueryClientProvider as Provider, QueryClient, QueryFunction, MutationFunction } from "@tanstack/react-query";
import { useContext } from "react";
import { AuthContext } from "./authContext";
import { supabase } from "../lib/supabase";

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
  useContext(AuthContext); // Keep the context connection for future use if needed
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 1,
      },
    },
  }));

  useEffect(() => {
    const setupAuthInterceptor = async () => {
      const { data } = await supabase.auth.getSession();

      const mutationKey = ['defaultMutation'];
      const oldMutateObj = queryClient.getMutationDefaults(mutationKey);
      const oldMutate = oldMutateObj?.mutationFn as MutationFunction<MutationVariables> | undefined;
      const oldFetch = queryClient.getDefaultOptions().queries?.queryFn;

      queryClient.setMutationDefaults(mutationKey, {
        mutationFn: async (variables: MutationVariables) => {
          if (oldMutate) {
            return oldMutate(variables);
          }

          const options = variables.options || {};
          const headers = options.headers || {};

          if (data.session) {
            (headers as Headers).append('Authorization', `Bearer ${data.session.access_token}`);
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

            if (data.session) {
              headers.append('Authorization', `Bearer ${data.session.access_token}`);
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

    const authStateListener = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        setupAuthInterceptor();
      }
    });

    return () => {
      authStateListener.data.subscription.unsubscribe();
    };
  }, [queryClient]);

  return (
    <Provider client={queryClient}>
      {children}
    </Provider>
  );
};