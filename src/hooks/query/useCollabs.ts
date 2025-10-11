import { useCollabsQuery } from '../../lib/gql/generated';
import { useGraphQLRequestConfig } from './useGraphQLRequestConfig';

export const useCollabs = () => {
  const {
    config,
    loading: configLoading,
    error: configError,
  } = useGraphQLRequestConfig('Collabs');
  const { data, isLoading, error } = useCollabsQuery(config);

  return {
    data,
    loading: configLoading || isLoading,
    error: configError || error,
  };
};
