import { motion } from 'motion/react';
import { Link } from '@tanstack/react-router';
import type { CollaborationPost } from './types';
import { formatDistanceToNow } from 'date-fns';

type CollaborationCardProps = {
  post: CollaborationPost;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
};

export function CollaborationCard({
  post,
  isBookmarked,
  onToggleBookmark,
}: CollaborationCardProps) {
  const typeColorMap: Record<number, string> = {
    1: 'bg-blue-500/20 text-blue-400 border-blue-500/30', // Paid
    2: 'bg-purple-500/20 text-purple-400 border-purple-500/30', // Hobby
    3: 'bg-orange-500/20 text-orange-400 border-orange-500/30', // Gametest
    4: 'bg-green-500/20 text-green-400 border-green-500/30', // Mentor
  };

  const hiringStatusColorMap: Record<number, string> = {
    1: 'text-cyan-400', // Looking
    2: 'text-yellow-400', // Offering
  };

  const typeColor = typeColorMap[post.collaborationTypeId] || 'bg-gray-500/20 text-gray-400';
  const hiringStatusColor = hiringStatusColorMap[post.hiringStatusId] || 'text-gray-400';

  const tags = post.tags ? JSON.parse(post.tags) : [];
  const mainFields = post.collaborationFieldValues?.slice(0, 3) || [];

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      className="bg-gray-800/50 backdrop-blur-sm rounded-lg p-6 border border-gray-700 hover:border-gray-600 transition-all"
    >
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          {/* Type and Hiring Status Badges */}
          <div className="flex items-center gap-2 mb-2">
            <span className={`px-2 py-1 rounded-md text-xs font-medium border ${typeColor}`}>
              {post.collaborationType?.name}
            </span>
            <span className={`text-xs font-medium ${hiringStatusColor}`}>
              {post.hiringStatus?.name}
            </span>
          </div>

          {/* Profile Info */}
          <h3 className="text-lg font-semibold text-white mb-1">
            {post.collaborationProfile?.displayName || 'Anonymous'}
          </h3>
        </div>

        {/* Bookmark Button */}
        {onToggleBookmark && (
          <button
            onClick={onToggleBookmark}
            className="text-gray-400 hover:text-yellow-400 transition-colors"
            aria-label={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
          >
            <svg
              className="w-5 h-5"
              fill={isBookmarked ? 'currentColor' : 'none'}
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Main Field Values */}
      {mainFields.length > 0 && (
        <div className="space-y-2 mb-4">
          {mainFields.map(field => (
            <div key={field.id} className="text-sm">
              <span className="text-gray-400">
                {field.collaborationFieldDefinition?.displayName}:{' '}
              </span>
              <span className="text-gray-200 line-clamp-2">{field.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {tags.map((tag: string, index: number) => (
            <span key={index} className="px-2 py-1 bg-gray-700/50 text-gray-300 rounded-md text-xs">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Stats and Actions */}
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-700">
        <div className="flex items-center gap-4 text-sm text-gray-400">
          <span className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
              />
            </svg>
            {post.viewCount}
          </span>
          <span className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
            {post.responseCount}
          </span>
          {post.postedAt && (
            <span>{formatDistanceToNow(new Date(post.postedAt), { addSuffix: true })}</span>
          )}
        </div>

        <Link
          to="/collaborations/$postId"
          params={{ postId: post.id }}
          className="text-green-400 hover:text-green-300 text-sm font-medium transition-colors"
        >
          View Details →
        </Link>
      </div>
    </motion.div>
  );
}
