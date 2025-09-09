import { motion } from 'motion/react';
import { CollaborationCard } from './CollaborationCard';
import type { CollaborationPost } from './types';

type CollaborationGridProps = {
  posts: CollaborationPost[];
  bookmarkedIds?: Set<string>;
  onToggleBookmark?: (postId: string) => void;
  isLoading?: boolean;
};

export function CollaborationGrid({
  posts,
  bookmarkedIds,
  onToggleBookmark,
  isLoading,
}: CollaborationGridProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700"
          >
            <div className="animate-pulse">
              <div className="flex items-center gap-2 mb-4">
                <div className="h-6 w-20 bg-gray-700 rounded-md" />
                <div className="h-6 w-16 bg-gray-700 rounded-md" />
              </div>
              <div className="h-5 w-32 bg-gray-700 rounded mb-4" />
              <div className="space-y-2">
                <div className="h-4 w-full bg-gray-700 rounded" />
                <div className="h-4 w-3/4 bg-gray-700 rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-12">
        <svg
          className="w-16 h-16 mx-auto text-gray-600 mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <h3 className="text-lg font-medium text-gray-300 mb-2">No collaborations found</h3>
        <p className="text-gray-500">Try adjusting your filters or search criteria</p>
      </motion.div>
    );
  }

  return (
    <div className="grid gap-4">
      {posts.map((post, index) => (
        <motion.div
          key={post.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: index * 0.05 }}
        >
          <CollaborationCard
            post={post}
            isBookmarked={bookmarkedIds?.has(post.id)}
            onToggleBookmark={onToggleBookmark ? () => onToggleBookmark(post.id) : undefined}
          />
        </motion.div>
      ))}
    </div>
  );
}
