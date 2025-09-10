import { motion } from 'motion/react';
import { CollaborationCard } from './CollaborationCard';
import { cn } from '../../lib/utils';
import type { CollaborationPost } from './types';

type CollaborationGridProps = {
  posts: CollaborationPost[];
  bookmarkedIds?: Set<string>;
  onToggleBookmark?: (postId: string) => void;
  isLoading?: boolean;
};

export const CollaborationGrid = ({
  posts,
  bookmarkedIds,
  onToggleBookmark,
  isLoading,
}: CollaborationGridProps) => {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="bg-gray-800 rounded-lg shadow-md overflow-hidden border border-gray-700"
          >
            <div className="animate-pulse">
              <div className="h-32 bg-gray-700" />
              <div className="p-6">
                <div className="flex items-center gap-2 mb-4">
                  <div className="h-6 w-20 bg-gray-700 rounded-md" />
                  <div className="h-6 w-16 bg-gray-700 rounded-md" />
                </div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="h-8 w-8 bg-gray-700 rounded-full" />
                  <div className="h-5 w-32 bg-gray-700 rounded" />
                </div>
                <div className="space-y-2">
                  <div className="h-4 w-full bg-gray-700 rounded" />
                  <div className="h-4 w-3/4 bg-gray-700 rounded" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex flex-col items-center justify-center py-16"
      >
        <div className="w-24 h-24 rounded-full bg-gray-800 flex items-center justify-center mb-6">
          <svg
            className="w-12 h-12 text-gray-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
            />
          </svg>
        </div>
        <h3 className="text-xl font-medium text-white mb-2">No collaborations found</h3>
        <p className="text-gray-400 text-center max-w-md">
          Try adjusting your filters or search criteria to find more collaborations.
        </p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
      className={cn('grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6')}
    >
      {posts.map(post => (
        <CollaborationCard
          key={post.id}
          post={post}
          isBookmarked={bookmarkedIds?.has(post.id)}
          onToggleBookmark={onToggleBookmark ? () => onToggleBookmark(post.id) : undefined}
        />
      ))}
    </motion.div>
  );
};
