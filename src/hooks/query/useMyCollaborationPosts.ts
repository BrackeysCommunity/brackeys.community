import { useGraphQLRequestConfig } from './useGraphQLRequestConfig';
import { useQuery } from '@tanstack/react-query';

const COLLABORATION_POSTS_QUERY = `
  query MyCollaborationPosts($profileId: String!) {
    collaborationPost(where: { profileId: { _eq: $profileId } }) {
      id
      statusId
      responseCount
      viewCount
      createdAt
      updatedAt
      collaborationTypeId
      hiringStatusId
    }
  }
`;

export const useMyCollaborationPosts = (profileId: string | null | undefined) => {
  const {
    config,
    loading: configLoading,
    error: configError,
  } = useGraphQLRequestConfig('MyCollaborationPosts');

  const shouldQuery = !!profileId && !!config;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['MyCollaborationPosts', profileId],
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
          query: COLLABORATION_POSTS_QUERY,
          variables: { profileId },
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

  const posts = data?.collaborationPost || [];

  return {
    posts,
    loading: configLoading || isLoading,
    error: configError || error,
    refetch,
  };
};
