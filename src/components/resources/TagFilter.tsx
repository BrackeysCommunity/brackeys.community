import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
} from '@headlessui/react';
import { ChevronDown } from 'lucide-react';
import type { ResourceFilterProps, ResourceTag } from './types';
import { FilterButton } from './FilterButton';
import { tagInfo } from './data';

type TagFilterProps = Pick<
  ResourceFilterProps,
  'activeTag' | 'setActiveTag' | 'tagCounts'
>;

export const TagFilter = ({
  activeTag,
  setActiveTag,
  tagCounts,
}: TagFilterProps) => {
  const timeoutRef = useRef<NodeJS.Timeout>(undefined);

  const buttonVariants = {
    initial: { opacity: 0, y: 10 },
    animate: (index: number) => ({
      opacity: 1,
      y: 0,
      transition: {
        delay: 0.05 * index,
        duration: 0.2,
      },
    }),
    hover: { scale: 1.03 },
    tap: { scale: 0.97 },
  };
  const visibleTags = Object.entries(tagCounts).filter(
    ([tag]) => tag !== 'all',
  );

  useEffect(() => {
    if (activeTag !== 'all') {
      const tagExists = Object.keys(tagCounts).includes(activeTag);
      if (!tagExists) {
        timeoutRef.current = setTimeout(() => setActiveTag('all'), 10);
      }
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [activeTag, setActiveTag, tagCounts]);

  const hasTagOptions = visibleTags.length > 0;

  return (
    <AnimatePresence>
      {hasTagOptions && (
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
                  <h2 className="text-xl font-semibold text-white">Tags</h2>
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
                        active={activeTag === 'all'}
                        label="All"
                        count={tagCounts.all}
                        onClick={() => setActiveTag('all')}
                      />
                    </motion.div>

                    <AnimatePresence mode="popLayout">
                      {visibleTags
                        .sort(([, countA], [, countB]) => countB - countA)
                        .map(([tag, count], index) => {
                          const info = tagInfo[tag as ResourceTag];
                          return (
                            <motion.div
                              key={tag}
                              initial="initial"
                              animate="animate"
                              custom={index + 1} // +1 because "All" button is index 0
                              variants={buttonVariants}
                              exit={{ opacity: 0, scale: 0.8 }}
                              whileHover="hover"
                              whileTap="tap"
                            >
                              <FilterButton
                                active={activeTag === tag}
                                label={info?.label || tag}
                                count={count}
                                onClick={() => setActiveTag(tag as ResourceTag)}
                                icon={info?.icon}
                                iconColor={info?.color.split(' ')[0]}
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
