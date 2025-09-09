import { useCollaborationTypesQuery } from '../../lib/gql/generated';
import { useGraphQLRequestConfig } from './useGraphQLRequestConfig';

export const useCollaborationTypes = () => {
  const {
    config,
    loading: configLoading,
    error: configError,
  } = useGraphQLRequestConfig('CollaborationTypes');
  const { data, isLoading, error } = useCollaborationTypesQuery(config);

  return {
    data: data?.collaborationType || [],
    loading: configLoading || isLoading,
    error: configError || error,
  };
};
