import { useGraphQLRequestConfig } from './useGraphQLRequestConfig';
import { useAuth } from '../../context/useAuth';
import { useQuery } from '@tanstack/react-query';

// Simplified query without nested relationships to avoid SQL scoping issue
const SIMPLE_PROFILE_QUERY = `
  query MyCollaborationProfileSimple($userId: Int64!) {
    collaborationProfile(where: { userId: { _eq: $userId } }) {
      id
      userId
      guildId
      displayName
      bio
      skills
      portfolio
      contactPreferences
      isPublic
      createdAt
      updatedAt
      lastActiveAt
    }
  }
`;

export const useMyCollaborationProfile = () => {
  const {
    state: { user },
  } = useAuth();

  const {
    config,
    loading: configLoading,
    error: configError,
  } = useGraphQLRequestConfig('MyCollaborationProfile');

  // Keep discord_id as string to avoid JavaScript number precision issues
  const discordId = user?.discord_id || null;
  const shouldQuery = !!discordId && !!config;

  console.log('discordId', discordId);

  // Use a custom query to avoid the SQL scoping bug in Hasura
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['MyCollaborationProfile', discordId],
    queryFn: async () => {
      if (!config) throw new Error('No config available');

      const response = await fetch(config.endpoint, {
        method: 'POST',
        ...config.fetchParams,
        headers: {
          'Content-Type': 'application/json',
          ...((config.fetchParams?.headers as Record<string, string>) || {}),
        },
        body: JSON.stringify({
          query: SIMPLE_PROFILE_QUERY,
          variables: { userId: discordId },
        }),
      });

      const result = await response.json();

      if (result.errors) {
        throw new Error(result.errors[0].message);
      }

      return result.data;
    },
    enabled: shouldQuery,
  });

  const profile = data?.collaborationProfile?.[0];

  return {
    profile,
    loading: configLoading || isLoading,
    error: configError || error,
    refetch,
  };
};
