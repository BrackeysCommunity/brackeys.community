import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  resources,
  ResourceType,
  ResourceCategory,
  ResourceTag,
  ResourceItem,
  FilterSidebar,
  ResourceSearch,
  ResourceGrid,
} from '../components/resources';

type ResourcesViewProps = {
  activeType: ResourceType | 'all';
  activeCategory: ResourceCategory | 'all';
  activeTag: ResourceTag | 'all';
  searchQuery: string;
  filteredResources: ResourceItem[];
  typeCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  tagCounts: Record<string, number>;
  setActiveType: (type: ResourceType | 'all') => void;
  setActiveCategory: (category: ResourceCategory | 'all') => void;
  setActiveTag: (tag: ResourceTag | 'all') => void;
  setSearchQuery: (query: string) => void;
};

const ResourcesView = ({
  activeType,
  activeCategory,
  activeTag,
  searchQuery,
  filteredResources,
  typeCounts,
  categoryCounts,
  tagCounts,
  setActiveType,
  setActiveCategory,
  setActiveTag,
  setSearchQuery,
}: ResourcesViewProps) => (
  <>
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <h1 className="text-3xl font-bold text-white mb-6">Games & Tools</h1>
      <p className="text-lg text-gray-300 mb-8">
        Discover games and tools for all types of development, made by the community and beyond.
      </p>
    </motion.div>

    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="flex flex-col md:flex-row gap-6"
    >
      <FilterSidebar
        activeType={activeType}
        setActiveType={setActiveType}
        activeCategory={activeCategory}
        setActiveCategory={setActiveCategory}
        activeTag={activeTag}
        setActiveTag={setActiveTag}
        typeCounts={typeCounts}
        categoryCounts={categoryCounts}
        tagCounts={tagCounts}
      />

      <div className="flex-1">
        <ResourceSearch searchQuery={searchQuery} setSearchQuery={setSearchQuery} />

        <ResourceGrid resources={filteredResources} searchQuery={searchQuery} />
      </div>
    </motion.div>
  </>
);

const ResourcesContainer = () => {
  const [activeType, setActiveType] = useState<ResourceType | 'all'>('all');
  const [activeCategory, setActiveCategory] = useState<ResourceCategory | 'all'>('all');
  const [activeTag, setActiveTag] = useState<ResourceTag | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  useEffect(() => {
    document.title = 'Games & Tools - Brackeys Community';
  }, []);

  const typeFilteredResources = resources.filter(resource => {
    return activeType === 'all' || resource.type === activeType;
  });

  const categoryFilteredResources = typeFilteredResources.filter(resource => {
    return (
      activeCategory === 'all' || resource.categories.includes(activeCategory as ResourceCategory)
    );
  });

  const tagFilteredResources = categoryFilteredResources.filter(resource => {
    return activeTag === 'all' || resource.tags.includes(activeTag as ResourceTag);
  });
  const typeCounts = resources.reduce<Record<string, number>>(
    (acc, resource) => {
      acc[resource.type] = (acc[resource.type] || 0) + 1;
      return acc;
    },
    { all: resources.length }
  );

  const categoryCounts = typeFilteredResources.reduce<Record<string, number>>(
    (acc, resource) => {
      resource.categories.forEach(category => {
        acc[category] = (acc[category] || 0) + 1;
      });
      return acc;
    },
    { all: typeFilteredResources.length }
  );

  const tagCounts = categoryFilteredResources.reduce<Record<string, number>>(
    (acc, resource) => {
      resource.tags.forEach(tag => {
        acc[tag] = (acc[tag] || 0) + 1;
      });
      return acc;
    },
    { all: categoryFilteredResources.length }
  );

  return (
    <ResourcesView
      activeType={activeType}
      activeCategory={activeCategory}
      activeTag={activeTag}
      searchQuery={searchQuery}
      filteredResources={tagFilteredResources}
      typeCounts={typeCounts}
      categoryCounts={categoryCounts}
      tagCounts={tagCounts}
      setActiveType={setActiveType}
      setActiveCategory={setActiveCategory}
      setActiveTag={setActiveTag}
      setSearchQuery={setSearchQuery}
    />
  );
};

export const Resources = ResourcesContainer;
