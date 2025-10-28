import { Link } from '@tanstack/react-router';
import { Gamepad2, Wrench } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';
import { categoryInfo, tagInfo } from './data';
import type { ResourceItem } from './types';

type ResourceCardProps = {
  resource: ResourceItem;
};

export const ResourceCard = ({ resource }: ResourceCardProps) => {
  const {
    id,
    title,
    description,
    imageUrl,
    categories,
    type,
    tags,
    developer,
    releaseDate,
    resourceUrl,
  } = resource;

  const primaryCategory = categories[0];
  const categoryData = categoryInfo[primaryCategory];
  const CategoryIcon = categoryData.icon;

  return (
    <motion.div
      key={`resource-${id}`}
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
      data-testid={`resource-card-${id}`}
    >
      <div className="relative w-full h-48 bg-gray-900">
        <div className="absolute inset-0 bg-line-pattern pattern-mask-fade-in pattern-opacity-100 z-0" />
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={title}
            className="w-full h-full object-contain relative z-10"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 z-10">
            {type === 'game' ? (
              <Gamepad2 className="h-12 w-12" />
            ) : (
              <Wrench className="h-12 w-12" />
            )}
          </div>
        )}
      </div>

      <div className="p-6 flex-grow flex flex-col">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <div className="flex items-center gap-1 bg-gray-700 px-2 py-1 rounded-md">
            <CategoryIcon className={cn('h-4 w-4', categoryData.color)} />
            <span className="text-xs text-gray-300">{categoryData.label}</span>
          </div>

          {categories.slice(1).map((cat) => {
            const catInfo = categoryInfo[cat];
            const CatIcon = catInfo.icon;
            return (
              <div
                key={cat}
                className="flex items-center gap-1 bg-gray-700 px-2 py-1 rounded-md"
              >
                <CatIcon className={cn('h-3 w-3', catInfo.color)} />
                <span className="text-xs text-gray-400">{catInfo.label}</span>
              </div>
            );
          })}
        </div>

        <h3 className="text-xl font-bold text-white mb-2">{title}</h3>
        <p className="text-gray-300 text-sm flex-grow">{description}</p>

        <div className="flex flex-wrap gap-2 mt-3 mb-3">
          {tags.map((tag) => {
            const tagData = tagInfo[tag];
            const TagIcon = tagData.icon;
            return (
              <div
                key={tag}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded-full text-xs',
                  tagData.color,
                )}
              >
                <TagIcon className="h-3 w-3" />
                <span>{tagData.label}</span>
              </div>
            );
          })}
        </div>

        {developer && (
          <div className="mt-1 flex justify-between items-center text-xs text-gray-400">
            <span>By {developer}</span>
            {releaseDate && (
              <span>
                Released: {new Date(releaseDate).toLocaleDateString()}
              </span>
            )}
          </div>
        )}
      </div>

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
          className="relative inline-flex grow items-center justify-center border border-transparent text-sm font-medium rounded-md shadow-xs text-white bg-brackeys-purple-600 hover:bg-brackeys-purple-700 transition-colors focus-within:outline-hidden focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-offset-gray-900 focus-within:ring-brackeys-purple-500 z-10 overflow-hidden pointer-events-auto"
        >
          {resourceUrl instanceof URL ? (
            <a
              href={resourceUrl.toString()}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute inset-0 flex items-center justify-center"
            >
              {type === 'game' ? 'Play Now' : 'Visit Website'}
            </a>
          ) : (
            <Link
              to={resourceUrl.toString()}
              className="absolute inset-0 flex items-center justify-center"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            >
              {type === 'game' ? 'Play Now' : 'View Tool'}
            </Link>
          )}
        </motion.div>
      </div>
    </motion.div>
  );
};
