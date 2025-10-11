import { useMyBookmarksQuery } from '../../lib/gql/generated';
import { useGraphQLRequestConfig } from './useGraphQLRequestConfig';

export const useMyBookmarks = (profileId?: string) => {
  const {
    config,
    loading: configLoading,
    error: configError,
  } = useGraphQLRequestConfig('MyBookmarks');

  const { data, isLoading, error, refetch } = useMyBookmarksQuery(
    config,
    { profileId: profileId || '' },
    { enabled: !!profileId && !!config },
  );

  const bookmarks = data?.collaborationBookmark || [];

  return {
    bookmarks,
    loading: configLoading || isLoading,
    error: configError || error,
    refetch,
  };
};
