import { motion } from 'motion/react';
import { TypeFilter } from './TypeFilter';
import { TagFilter } from './TagFilter';
import { CategoryFilter } from './CategoryFilter';
import { ResourceFilterProps } from './types';
import { cn } from '../../lib/utils';

type FilterSidebarProps = ResourceFilterProps;

export const FilterSidebar = ({
  activeType,
  setActiveType,
  activeCategory,
  setActiveCategory,
  activeTag,
  setActiveTag,
  typeCounts,
  categoryCounts,
  tagCounts,
}: FilterSidebarProps) => (
  <motion.div
    className={cn(
      'w-full md:w-80 lg:w-96 shrink-0 md:sticky md:top-24 md:self-start',
      'md:max-h-[calc(100dvh-7rem)]',
      'custom-scrollbar scrollbar-stable md:overflow-hidden md:hover:overflow-y-auto',
      'rounded-lg',
    )}
    initial={{ opacity: 0, x: -10 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ duration: 0.4, delay: 0.1 }}
  >
    <div className="h-full pr-1">
      <TypeFilter
        activeType={activeType}
        setActiveType={setActiveType}
        typeCounts={typeCounts}
      />

      <TagFilter
        activeTag={activeTag}
        setActiveTag={setActiveTag}
        tagCounts={tagCounts}
      />

      <CategoryFilter
        activeCategory={activeCategory}
        setActiveCategory={setActiveCategory}
        categoryCounts={categoryCounts}
        activeType={activeType}
      />
    </div>
  </motion.div>
);
