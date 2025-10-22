import type { operations } from '../../lib/gql/operations';
import { useAuthHeaders } from './useAuthHeaders';

export const useGraphQLRequestConfig = (opName?: keyof typeof operations) => {
  const { headers, loading, error } = useAuthHeaders(opName);
  return {
    config: {
      endpoint: import.meta.env.VITE_HASURA_GRAPHQL_URL || '',
      fetchParams: { headers },
    },
    loading,
    error,
  };
};
