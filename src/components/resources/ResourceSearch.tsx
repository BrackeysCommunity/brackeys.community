import { motion } from 'motion/react';

type ResourceSearchProps = {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
};

export const ResourceSearch = ({ searchQuery, setSearchQuery }: ResourceSearchProps) => (
  <div className="mb-6">
    <motion.input
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, delay: 0.2 }}
      type="text"
      placeholder="Search resources..."
      className="w-full px-4 py-3 bg-gray-800 text-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brackeys-purple-500"
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      data-testid="resources-search-input"
    />
  </div>
);
