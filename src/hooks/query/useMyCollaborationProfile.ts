import { useMyCollaborationProfileQuery } from '../../lib/gql/generated';
import { useGraphQLRequestConfig } from './useGraphQLRequestConfig';
import { useAuth } from '../../context/useAuth';

export const useMyCollaborationProfile = () => {
  const {
    state: { user },
  } = useAuth();

  const {
    config,
    loading: configLoading,
    error: configError,
  } = useGraphQLRequestConfig('MyCollaborationProfile');

  const shouldQuery = !!user?.id && !!config;

  const { data, isLoading, error, refetch } = useMyCollaborationProfileQuery(
    config,
    { userId: user?.id || 0 },
    { enabled: shouldQuery }
  );

  const profile = data?.collaborationProfile?.[0];

  return {
    profile,
    loading: configLoading || isLoading,
    error: configError || error,
    refetch,
  };
};
