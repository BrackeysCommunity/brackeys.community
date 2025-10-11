import { useCollaborationPostDetailQuery } from '../../lib/gql/generated';
import { useGraphQLRequestConfig } from './useGraphQLRequestConfig';

export const useCollaborationPost = (postId: string) => {
  const {
    config,
    loading: configLoading,
    error: configError,
  } = useGraphQLRequestConfig('CollaborationPostDetail');

  const { data, isLoading, error } = useCollaborationPostDetailQuery(
    config,
    { id: postId },
    { enabled: !!postId && !!config },
  );

  return {
    post: data?.collaborationPostById,
    loading: configLoading || isLoading,
    error: configError || error,
  };
};
