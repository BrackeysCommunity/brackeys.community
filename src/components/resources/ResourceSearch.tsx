import { motion } from 'motion/react';
import { Input } from '../ui/Input';

type ResourceSearchProps = {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
};

export const ResourceSearch = ({ searchQuery, setSearchQuery }: ResourceSearchProps) => (
  <motion.div
    className="mb-6"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ duration: 0.3, delay: 0.2 }}
  >
    <Input
      type="text"
      placeholder="Search resources..."
      value={searchQuery}
      onChange={setSearchQuery}
      data-testid="resources-search-input"
    />
  </motion.div>
);
