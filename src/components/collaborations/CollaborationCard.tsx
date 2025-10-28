import { Link } from '@tanstack/react-router';
import { formatDistanceToNow } from 'date-fns';
import {
  ArrowUpRight,
  Bookmark,
  Briefcase,
  Eye,
  GraduationCap,
  Heart,
  MessageCircle,
  TestTube,
  User,
} from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';
import type { CollaborationPost } from './types';

type CollaborationCardProps = {
  post: CollaborationPost;
  isBookmarked?: boolean;
  onToggleBookmark?: () => void;
};

const typeIcons = {
  1: Briefcase, // Paid
  2: Heart, // Hobby
  3: TestTube, // Gametest
  4: GraduationCap, // Mentor
};

const typeColors = {
  1: 'text-blue-400',
  2: 'text-purple-400',
  3: 'text-orange-400',
  4: 'text-green-400',
};

const hiringStatusColors = {
  1: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30', // Looking
  2: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', // Offering
};

export const CollaborationCard = ({
  post,
  isBookmarked,
  onToggleBookmark,
}: CollaborationCardProps) => {
  const TypeIcon =
    typeIcons[post.collaborationTypeId as keyof typeof typeIcons] || Briefcase;
  const typeColor =
    typeColors[post.collaborationTypeId as keyof typeof typeColors] ||
    'text-gray-400';
  const hiringStatusColor =
    hiringStatusColors[
      post.hiringStatusId as keyof typeof hiringStatusColors
    ] || 'bg-gray-500/20 text-gray-400';

  const tags = post.tags ? JSON.parse(post.tags) : [];
  const mainFields = post.collaborationFieldValues?.slice(0, 2) || [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        type: 'spring',
        stiffness: 300,
        damping: 20,
      }}
      className={cn(
        'flex flex-col h-full',
        'bg-gray-800 rounded-lg shadow-md overflow-hidden border border-gray-700',
        'hover:border-brackeys-purple-500 transition-colors',
      )}
    >
      {/* Header with Type Icon */}
      <div className="relative w-full h-32 bg-gray-900">
        <div className="absolute inset-0 bg-line-pattern pattern-mask-fade-in pattern-opacity-100 z-0" />
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <TypeIcon className={cn('h-12 w-12', typeColor)} />
        </div>

        {/* Bookmark Button */}
        {onToggleBookmark && (
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={onToggleBookmark}
            className="absolute top-2 right-2 p-2 rounded-full bg-gray-800/80 hover:bg-gray-700 transition-colors z-20"
            aria-label={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
          >
            <Bookmark
              className={cn(
                'h-4 w-4',
                isBookmarked
                  ? 'fill-yellow-400 text-yellow-400'
                  : 'text-gray-400',
              )}
            />
          </motion.button>
        )}
      </div>

      {/* Content */}
      <div className="p-6 flex-grow flex flex-col">
        {/* Badges */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div
            className={cn(
              'px-2 py-1 rounded-md text-xs font-medium border',
              hiringStatusColor,
            )}
          >
            {post.hiringStatus?.name}
          </div>
          <div className="flex items-center gap-1 bg-gray-700 px-2 py-1 rounded-md">
            <TypeIcon className={cn('h-3 w-3', typeColor)} />
            <span className="text-xs text-gray-300">
              {post.collaborationType?.name}
            </span>
          </div>
        </div>

        {/* Profile Info */}
        <div className="flex items-center gap-2 mb-3">
          <div className="h-8 w-8 rounded-full bg-gray-700 flex items-center justify-center">
            <User className="h-4 w-4 text-gray-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">
              {post.collaborationProfile?.displayName || 'Anonymous'}
            </h3>
          </div>
        </div>

        {/* Main Fields */}
        {mainFields.length > 0 && (
          <div className="space-y-2 mb-4 flex-grow">
            {mainFields.map((field) => (
              <div key={field.id} className="text-sm">
                <span className="text-gray-400">
                  {field.collaborationFieldDefinition?.displayName}:
                </span>
                <p className="text-gray-200 line-clamp-2 mt-1">{field.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-4">
            {tags.slice(0, 3).map((tag: string, index: number) => (
              <span
                key={tag + index.toString()}
                className="px-2 py-1 bg-gray-700/50 text-gray-400 rounded-full text-xs"
              >
                {tag}
              </span>
            ))}
            {tags.length > 3 && (
              <span className="px-2 py-1 text-gray-500 text-xs">
                +{tags.length - 3} more
              </span>
            )}
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 text-xs text-gray-400 mt-auto">
          <span className="flex items-center gap-1">
            <Eye className="h-3 w-3" />
            {post.viewCount}
          </span>
          <span className="flex items-center gap-1">
            <MessageCircle className="h-3 w-3" />
            {post.responseCount}
          </span>
          {post.postedAt && (
            <span className="ml-auto">
              {formatDistanceToNow(new Date(post.postedAt), {
                addSuffix: true,
              })}
            </span>
          )}
        </div>
      </div>

      {/* Action Button */}
      <div className="relative flex border-t border-gray-700 bg-gray-900 overflow-hidden">
        <div className="absolute inset-0 bg-line-pattern pattern-mask-fade-out pattern-opacity-100 z-0" />
        <motion.div
          initial={{ margin: '16px', padding: '16px 16px' }}
          whileHover={{
            margin: '0px',
            padding: '32px 16px',
            borderTopLeftRadius: '0px',
            borderTopRightRadius: '0px',
            transition: { type: 'tween', duration: 0.2, ease: 'easeOut' },
          }}
          whileTap={{
            margin: '8px',
            padding: '24px 16px',
            borderTopLeftRadius: '6px',
            borderTopRightRadius: '6px',
          }}
          transition={{ type: 'spring', stiffness: 400, damping: 17 }}
          className="relative inline-flex grow items-center justify-center border border-transparent text-sm font-medium rounded-md shadow-xs text-white bg-brackeys-purple-600 hover:bg-brackeys-purple-700 transition-colors focus-within:outline-hidden focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-offset-gray-900 focus-within:ring-brackeys-purple-500 z-10 overflow-hidden"
        >
          <Link
            to="/collaborations/$postId"
            params={{ postId: post.id }}
            className="absolute inset-0 flex items-center justify-center gap-2"
          >
            View Details
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </motion.div>
      </div>
    </motion.div>
  );
};
