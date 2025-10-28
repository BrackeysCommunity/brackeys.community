import { motion } from 'motion/react';
import { useState } from 'react';
import type { CollaborationFilters } from './types';

type CollaborationSearchProps = {
  filters: CollaborationFilters;
  setFilters: (filters: CollaborationFilters) => void;
};

export function CollaborationSearch({
  filters,
  setFilters,
}: CollaborationSearchProps) {
  const [localSearchQuery, setLocalSearchQuery] = useState(filters.searchQuery);

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFilters({ ...filters, searchQuery: localSearchQuery });
  };

  return (
    <motion.form
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1 }}
      onSubmit={handleSearch}
      className="mb-6"
    >
      <div className="relative">
        <input
          type="text"
          value={localSearchQuery}
          onChange={(e) => setLocalSearchQuery(e.target.value)}
          placeholder="Search collaborations by title, tags, or skills..."
          className="w-full px-4 py-3 pl-10 bg-gray-800/50 backdrop-blur-sm text-white rounded-lg border border-gray-700 focus:border-green-500 focus:outline-none transition-colors"
        />
        <svg
          className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        {localSearchQuery && (
          <button
            type="button"
            onClick={() => {
              setLocalSearchQuery('');
              setFilters({ ...filters, searchQuery: '' });
            }}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>
    </motion.form>
  );
}
