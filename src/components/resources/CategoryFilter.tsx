import { ResourceFilterProps, ResourceCategory } from './types';
import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react';
import { ChevronDown } from 'lucide-react';
import { FilterButton } from './FilterButton';
import { categoryInfo } from './data';

type CategoryFilterProps = Pick<ResourceFilterProps, 'activeCategory' | 'setActiveCategory' | 'categoryCounts' | 'activeType'>;

export const CategoryFilter = ({
  activeCategory,
  setActiveCategory,
  categoryCounts,
  activeType
}: CategoryFilterProps) => {
  const title = activeType === 'all' ? 'Genres & Categories' :
    activeType === 'game' ? 'Game Genres' : 'Tool Categories';

  const timeoutRef = useRef<NodeJS.Timeout>(undefined);

  const buttonVariants = {
    initial: { opacity: 0, y: 10 },
    animate: (index: number) => ({
      opacity: 1,
      y: 0,
      transition: {
        delay: 0.05 * index,
        duration: 0.2
      }
    }),
    hover: { scale: 1.03 },
    tap: { scale: 0.97 }
  };

  const visibleCategories = Object.entries(categoryCounts)
    .filter(([category]) => {
      if (category === 'all') return false;
      const info = categoryInfo[category as ResourceCategory];
      return info && (activeType === 'all' || info.type === activeType);
    });

  useEffect(() => {
    if (activeType !== 'all' && activeCategory !== 'all') {
      const activeCategoryInfo = categoryInfo[activeCategory as ResourceCategory];
      if (activeCategoryInfo && activeCategoryInfo.type !== activeType) {
        timeoutRef.current = setTimeout(() => setActiveCategory('all'), 10);
      }
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [activeType, activeCategory, setActiveCategory]);

  const hasCategoryOptions = visibleCategories.length > 0;

  return (
    <AnimatePresence>
      {(hasCategoryOptions || activeType === 'all') && (
        <motion.div
          className="bg-gray-800 rounded-lg mb-4"
          initial={{ opacity: 0, scale: 0.95, y: -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -10 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
        >
          <Disclosure as="div" defaultOpen={true}>
            {({ open }) => (
              <>
                <DisclosureButton className="w-full px-4 py-3 flex justify-between items-center text-left">
                  <h2 className="text-xl font-semibold text-white">{title}</h2>
                  <motion.div
                    animate={{ rotate: open ? 0 : -90 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ChevronDown className="h-5 w-5 text-gray-400" />
                  </motion.div>
                </DisclosureButton>

                <DisclosurePanel className="px-4 pb-4">
                  <div className="flex flex-wrap gap-2">
                    <motion.div
                      key="all"
                      initial="initial"
                      animate="animate"
                      custom={0}
                      variants={buttonVariants}
                      whileHover="hover"
                      whileTap="tap"
                    >
                      <FilterButton
                        active={activeCategory === 'all'}
                        label="All"
                        count={categoryCounts.all}
                        onClick={() => setActiveCategory('all')}
                      />
                    </motion.div>

                    <AnimatePresence mode="popLayout">
                      {visibleCategories
                        .sort(([, countA], [, countB]) => countB - countA)
                        .map(([category, count], index) => {
                          const info = categoryInfo[category as ResourceCategory];
                          return (
                            <motion.div
                              key={category}
                              initial="initial"
                              animate="animate"
                              custom={index + 1} // +1 because "All" button is index 0
                              variants={buttonVariants}
                              exit={{ opacity: 0, scale: 0.8 }}
                              whileHover="hover"
                              whileTap="tap"
                            >
                              <FilterButton
                                active={activeCategory === category}
                                label={info?.label || category}
                                count={count}
                                onClick={() => setActiveCategory(category as ResourceCategory)}
                                icon={info?.icon}
                                iconColor={info?.color}
                              />
                            </motion.div>
                          );
                        })}
                    </AnimatePresence>
                  </div>
                </DisclosurePanel>
              </>
            )}
          </Disclosure>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
