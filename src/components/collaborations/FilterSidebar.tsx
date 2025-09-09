import { motion } from 'motion/react';
import type { CollaborationType, HiringStatus, CollaborationFilters } from './types';

type FilterSidebarProps = {
  filters: CollaborationFilters;
  setFilters: (filters: CollaborationFilters) => void;
  collaborationTypes: CollaborationType[];
  hiringStatuses: HiringStatus[];
  typeCounts: Record<string, number>;
  hiringStatusCounts: Record<string, number>;
};

export function FilterSidebar({
  filters,
  setFilters,
  collaborationTypes,
  hiringStatuses,
  typeCounts,
  hiringStatusCounts,
}: FilterSidebarProps) {
  const sortOptions = [
    { value: 'recent', label: 'Most Recent' },
    { value: 'popular', label: 'Most Popular' },
    { value: 'responses', label: 'Most Responses' },
  ] as const;

  return (
    <div className="w-full md:w-64 bg-gray-800/50 rounded-lg p-4 backdrop-blur-sm">
      <h2 className="text-lg font-semibold text-white mb-4">Filters</h2>

      {/* Collaboration Type Filter */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-300 mb-2">Collaboration Type</h3>
        <div className="space-y-1">
          <button
            onClick={() => setFilters({ ...filters, typeId: 'all' })}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
              filters.typeId === 'all'
                ? 'bg-green-500/20 text-green-400'
                : 'hover:bg-gray-700 text-gray-300'
            }`}
          >
            <div className="flex justify-between items-center">
              <span>All Types</span>
              <span className="text-xs text-gray-500">{typeCounts.all || 0}</span>
            </div>
          </button>
          {collaborationTypes.map(type => (
            <button
              key={type.id}
              onClick={() => setFilters({ ...filters, typeId: type.id })}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                filters.typeId === type.id
                  ? 'bg-green-500/20 text-green-400'
                  : 'hover:bg-gray-700 text-gray-300'
              }`}
            >
              <div className="flex justify-between items-center">
                <span>{type.name}</span>
                <span className="text-xs text-gray-500">{typeCounts[type.id] || 0}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Hiring Status Filter */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-300 mb-2">Hiring Status</h3>
        <div className="space-y-1">
          <button
            onClick={() => setFilters({ ...filters, hiringStatusId: 'all' })}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
              filters.hiringStatusId === 'all'
                ? 'bg-green-500/20 text-green-400'
                : 'hover:bg-gray-700 text-gray-300'
            }`}
          >
            <div className="flex justify-between items-center">
              <span>All</span>
              <span className="text-xs text-gray-500">{hiringStatusCounts.all || 0}</span>
            </div>
          </button>
          {hiringStatuses.map(status => (
            <button
              key={status.id}
              onClick={() => setFilters({ ...filters, hiringStatusId: status.id })}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                filters.hiringStatusId === status.id
                  ? 'bg-green-500/20 text-green-400'
                  : 'hover:bg-gray-700 text-gray-300'
              }`}
            >
              <div className="flex justify-between items-center">
                <span>{status.name}</span>
                <span className="text-xs text-gray-500">{hiringStatusCounts[status.id] || 0}</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Sort By */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-300 mb-2">Sort By</h3>
        <div className="space-y-1">
          {sortOptions.map(option => (
            <button
              key={option.value}
              onClick={() => setFilters({ ...filters, sortBy: option.value })}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                filters.sortBy === option.value
                  ? 'bg-green-500/20 text-green-400'
                  : 'hover:bg-gray-700 text-gray-300'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Active Filters Summary */}
      {(filters.typeId !== 'all' || filters.hiringStatusId !== 'all') && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 pt-6 border-t border-gray-700"
        >
          <button
            onClick={() =>
              setFilters({
                ...filters,
                typeId: 'all',
                hiringStatusId: 'all',
                statusId: 'all',
              })
            }
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Clear all filters
          </button>
        </motion.div>
      )}
    </div>
  );
}
