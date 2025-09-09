import { useHiringStatusesQuery } from '../../lib/gql/generated';
import { useGraphQLRequestConfig } from './useGraphQLRequestConfig';

export const useHiringStatuses = () => {
  const {
    config,
    loading: configLoading,
    error: configError,
  } = useGraphQLRequestConfig('HiringStatuses');
  const { data, isLoading, error } = useHiringStatusesQuery(config);

  return {
    data: data?.hiringStatus || [],
    loading: configLoading || isLoading,
    error: configError || error,
  };
};
