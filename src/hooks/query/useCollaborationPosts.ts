import { useMemo } from 'react';
import type { CollaborationFilters } from '../../components/collaborations/types';
import { OrderBy, useCollaborationPostsQuery } from '../../lib/gql/generated';
import { useGraphQLRequestConfig } from './useGraphQLRequestConfig';

export const useCollaborationPosts = (filters: CollaborationFilters) => {
  const {
    config,
    loading: configLoading,
    error: configError,
  } = useGraphQLRequestConfig('CollaborationPosts');

  const queryVariables = useMemo(() => {
    const where: Record<string, unknown> = {
      statusId: { _eq: 2 }, // Only show active posts
    };

    if (filters.typeId !== 'all') {
      where.collaborationTypeId = { _eq: filters.typeId };
    }

    if (filters.hiringStatusId !== 'all') {
      where.hiringStatusId = { _eq: filters.hiringStatusId };
    }

    if (filters.searchQuery && filters.searchQuery.trim() !== '') {
      where._or = [
        { tags: { _contains: filters.searchQuery } },
        {
          collaborationProfile: {
            displayName: { _contains: filters.searchQuery },
          },
        },
        {
          collaborationProfile: { skills: { _contains: filters.searchQuery } },
        },
      ];
    }

    const orderBy =
      filters.sortBy === 'popular'
        ? { viewCount: OrderBy.Desc }
        : filters.sortBy === 'responses'
          ? { responseCount: OrderBy.Desc }
          : { postedAt: OrderBy.Desc };

    return {
      where,
      order_by: [orderBy],
      limit: 50,
    };
  }, [filters]);

  const { data, isLoading, error, refetch } = useCollaborationPostsQuery(
    config,
    queryVariables,
    {
      enabled: !!config,
    },
  );

  const posts = data?.collaborationPost || [];
  const totalCount = data?.collaborationPostAggregate?._count || 0;

  return {
    posts,
    totalCount,
    loading: configLoading || isLoading,
    error: configError || error,
    refetch,
  };
};
