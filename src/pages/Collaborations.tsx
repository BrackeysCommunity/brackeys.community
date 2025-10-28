import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import {
  type CollaborationFilters,
  CollaborationGrid,
  type CollaborationPost,
  CollaborationSearch,
  type CollaborationType,
  FilterSidebar,
  type HiringStatus,
} from '../components/collaborations';
import { useCollaborationPosts } from '../hooks/query/useCollaborationPosts';
import { useCollaborationTypes } from '../hooks/query/useCollaborationTypes';
import { useHiringStatuses } from '../hooks/query/useHiringStatuses';

type CollaborationsViewProps = {
  filters: CollaborationFilters;
  setFilters: (filters: CollaborationFilters) => void;
  posts: CollaborationPost[];
  isLoading: boolean;
  collaborationTypes: CollaborationType[];
  hiringStatuses: HiringStatus[];
  typeCounts: Record<string, number>;
  hiringStatusCounts: Record<string, number>;
};

const CollaborationsView = ({
  filters,
  setFilters,
  posts,
  isLoading,
  collaborationTypes,
  hiringStatuses,
  typeCounts,
  hiringStatusCounts,
}: CollaborationsViewProps) => (
  <>
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <h1 className="text-3xl font-bold text-white mb-6">Collaborations</h1>
      <p className="text-lg text-gray-300 mb-8">
        Find teammates, mentors, or projects. Connect with developers looking to
        collaborate.
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
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="mb-4 text-sm text-gray-400"
          >
            Found {posts.length} collaboration{posts.length !== 1 ? 's' : ''}
            {filters.searchQuery && ` matching "${filters.searchQuery}"`}
          </motion.div>
        )}

        <CollaborationGrid posts={posts} isLoading={isLoading} />
      </div>
    </motion.div>
  </>
);

const CollaborationsContainer = () => {
  const [filters, setFilters] = useState<CollaborationFilters>({
    typeId: 'all',
    hiringStatusId: 'all',
    statusId: 'all',
    searchQuery: '',
    sortBy: 'recent',
  });

  useEffect(() => {
    document.title = 'Collaborations - Brackeys Community';
  }, []);

  // Use our custom hooks
  const { data: collaborationTypes = [], loading: typesLoading } =
    useCollaborationTypes();
  const { data: hiringStatuses = [], loading: statusesLoading } =
    useHiringStatuses();
  const { posts, loading: postsLoading } = useCollaborationPosts(filters);

  // Calculate counts for filters
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: posts.length };
    posts.forEach((post) => {
      counts[post.collaborationTypeId] =
        (counts[post.collaborationTypeId] || 0) + 1;
    });
    return counts;
  }, [posts]);

  const hiringStatusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: posts.length };
    posts.forEach((post) => {
      counts[post.hiringStatusId] = (counts[post.hiringStatusId] || 0) + 1;
    });
    return counts;
  }, [posts]);

  const isLoading = typesLoading || statusesLoading || postsLoading;

  return (
    <CollaborationsView
      filters={filters}
      setFilters={setFilters}
      posts={posts as CollaborationPost[]}
      isLoading={isLoading}
      collaborationTypes={collaborationTypes}
      hiringStatuses={hiringStatuses}
      typeCounts={typeCounts}
      hiringStatusCounts={hiringStatusCounts}
    />
  );
};

export const Collaborations = CollaborationsContainer;
