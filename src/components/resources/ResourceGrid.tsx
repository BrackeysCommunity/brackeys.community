import { motion } from 'motion/react';
import { ResourceCard } from './ResourceCard';
import type { ResourceItem } from './types';

type ResourceGridProps = {
  resources: ResourceItem[];
  searchQuery: string;
};

export const ResourceGrid = ({ resources, searchQuery }: ResourceGridProps) => {
  const filteredResources = resources.filter((resource) => {
    const matchesSearch =
      searchQuery === '' ||
      resource.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      resource.description.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesSearch;
  });

  if (filteredResources.length === 0) {
    return (
      <motion.div
        className="text-center py-12 bg-gray-800 rounded-lg"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <p className="text-lg text-gray-300">
          No resources found matching your criteria.
        </p>
      </motion.div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
      {filteredResources.map((resource, index) => (
        <motion.div
          key={resource.id}
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '200px' }}
          transition={{
            duration: 0.35,
            delay: Math.min(index * 0.05, 0.3),
            ease: [0.25, 0.1, 0.25, 1.0],
          }}
        >
          <ResourceCard resource={resource} />
        </motion.div>
      ))}
    </div>
  );
};
