import { useAuth as useClerkAuth } from '@clerk/tanstack-react-start';
import {
  type QueryKey,
  type UseMutationOptions,
  type UseQueryOptions,
  useMutation,
  useQuery,
} from '@tanstack/react-query';
import type { Variables } from 'graphql-request';
import { type RequestExtendedOptions, request } from 'graphql-request';
import { operations, preferredRoles } from '../lib/gql/operations';
import { type HasuraClaims, useHasuraClaims } from '../store';

interface GraphQLQueryOptions<
  TData,
  TVariables extends Variables,
  TError = Error,
> {
  operationName: keyof typeof operations;
  variables?: TVariables;
  headers?: HeadersInit;
  queryOptions?: Omit<
    UseQueryOptions<TData, TError, TData, QueryKey>,
    'queryKey' | 'queryFn'
  >;
}

interface GraphQLMutationOptions<
  TData,
  TVariables extends Variables,
  TError = Error,
  TContext = unknown,
> {
  operationName: keyof typeof operations;
  headers?: HeadersInit;
  mutationOptions?: Omit<
    UseMutationOptions<TData, TError, TVariables, TContext>,
    'mutationFn'
  >;
}

/**
 * Builds headers with authentication and Hasura role headers
 */
const buildAuthHeaders = async (
  getToken: (options?: { template?: string }) => Promise<string | null>,
  operationName?: keyof typeof operations,
  hasuraClaims?: HasuraClaims,
): Promise<Record<string, string>> => {
  const headers: Record<string, string> = {};
  const token = await getToken({ template: 'hasura' });

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (operationName && hasuraClaims) {
    const preferredRole = preferredRoles[operationName];
    if (preferredRole && hasuraClaims.allowedRoles.includes(preferredRole)) {
      headers['x-hasura-role'] = preferredRole;
    }
  }

  return headers;
};

/**
 * Custom hook for GraphQL queries using TanStack Query
 */
export const useGraphQLQuery = <
  TData,
  TVariables extends Variables = Variables,
  TError = Error,
>({
  operationName,
  variables,
  queryOptions,
}: GraphQLQueryOptions<TData, TVariables, TError>) => {
  const hasuraClaims = useHasuraClaims();
  const { getToken } = useClerkAuth();
  const queryKey = ['graphql', operationName, variables] as const;

  return useQuery({
    queryKey,
    queryFn: async () => {
      const authHeaders = await buildAuthHeaders(
        getToken,
        operationName,
        hasuraClaims ?? undefined,
      );

      const requestOptions = {
        url: process.env.VITE_HASURA_GRAPHQL_URL,
        document: operations[operationName],
        variables,
        requestHeaders: authHeaders,
      } as unknown as RequestExtendedOptions<TVariables, TData>;

      return request<TData, TVariables>(requestOptions);
    },
    ...queryOptions,
  });
};

/**
 * Custom hook for GraphQL mutations using TanStack Query
 */
export const useGraphQLMutation = <
  TData,
  TVariables extends Variables = Variables,
  TError = Error,
  TContext = unknown,
>({
  operationName,
  mutationOptions,
}: GraphQLMutationOptions<TData, TVariables, TError, TContext>) => {
  const hasuraClaims = useHasuraClaims();
  const { getToken } = useClerkAuth();

  return useMutation<TData, TError, TVariables, TContext>({
    mutationFn: async (variables) => {
      const authHeaders = await buildAuthHeaders(
        getToken,
        operationName,
        hasuraClaims ?? undefined,
      );

      const requestOptions = {
        url: process.env.VITE_HASURA_GRAPHQL_URL,
        document: operations[operationName],
        variables,
        requestHeaders: authHeaders,
      } as unknown as RequestExtendedOptions<TVariables, TData>;

      return request<TData, TVariables>(requestOptions);
    },
    ...mutationOptions,
  });
};
