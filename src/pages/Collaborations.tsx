import { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  CollaborationFilters,
  CollaborationPost,
  FilterSidebar,
  CollaborationSearch,
  CollaborationGrid,
} from '../components/collaborations';
import { useCollaborationTypes } from '../hooks/query/useCollaborationTypes';
import { useHiringStatuses } from '../hooks/query/useHiringStatuses';
import { useCollaborationPostsQuery } from '../lib/gql/generated';
import { useGraphQLRequestConfig } from '../hooks/query/useGraphQLRequestConfig';
import { OrderBy } from '../lib/gql/generated';

export function Collaborations() {
  const [filters, setFilters] = useState<CollaborationFilters>({
    typeId: 'all',
    hiringStatusId: 'all',
    statusId: 'all',
    searchQuery: '',
    sortBy: 'recent',
  });

  // Fetch collaboration types and hiring statuses
  const { data: collaborationTypes = [], loading: typesLoading } = useCollaborationTypes();
  const { data: hiringStatuses = [], loading: statusesLoading } = useHiringStatuses();

  // Build GraphQL query variables based on filters
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

    if (filters.searchQuery) {
      where._or = [
        { tags: { _contains: filters.searchQuery } },
        { collaborationProfile: { displayName: { _contains: filters.searchQuery } } },
        { collaborationProfile: { skills: { _contains: filters.searchQuery } } },
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

  // Fetch collaboration posts
  const { config } = useGraphQLRequestConfig('CollaborationPosts');
  const { data, isLoading } = useCollaborationPostsQuery(config, queryVariables);

  const posts = data?.collaborationPost || [];

  // Calculate counts for filters
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: posts.length };
    posts.forEach(post => {
      counts[post.collaborationTypeId] = (counts[post.collaborationTypeId] || 0) + 1;
    });
    return counts;
  }, [posts]);

  const hiringStatusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: posts.length };
    posts.forEach(post => {
      counts[post.hiringStatusId] = (counts[post.hiringStatusId] || 0) + 1;
    });
    return counts;
  }, [posts]);

  useEffect(() => {
    document.title = 'Collaborations - Brackeys Community';
  }, []);

  return (
    <div className="container mx-auto px-4 py-8">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <h1 className="text-3xl font-bold text-white mb-6">Collaborations</h1>
        <p className="text-lg text-gray-300 mb-8">
          Find teammates, mentors, or projects. Connect with developers looking to collaborate.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="flex flex-col md:flex-row gap-6"
      >
        <FilterSidebar
          filters={filters}
          setFilters={setFilters}
          collaborationTypes={collaborationTypes}
          hiringStatuses={hiringStatuses}
          typeCounts={typeCounts}
          hiringStatusCounts={hiringStatusCounts}
        />

        <div className="flex-1">
          <CollaborationSearch filters={filters} setFilters={setFilters} />

          {/* Results Summary */}
          {!isLoading && (
            <div className="mb-4 text-sm text-gray-400">
              Found {posts.length} collaboration{posts.length !== 1 ? 's' : ''}
              {filters.searchQuery && ` matching "${filters.searchQuery}"`}
            </div>
          )}

          <CollaborationGrid
            posts={posts as CollaborationPost[]}
            isLoading={isLoading || typesLoading || statusesLoading}
          />
        </div>
      </motion.div>
    </div>
  );
}
