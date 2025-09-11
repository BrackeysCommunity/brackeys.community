import { motion } from 'motion/react';
import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react';
import { ChevronDown } from 'lucide-react';
import { FilterButton } from './FilterButton';
import type { CollaborationType, CollaborationFilters } from './types';

type TypeFilterProps = {
  filters: CollaborationFilters;
  setFilters: (filters: CollaborationFilters) => void;
  collaborationTypes: CollaborationType[];
  typeCounts: Record<string, number>;
};

export const TypeFilter = ({
  filters,
  setFilters,
  collaborationTypes,
  typeCounts,
}: TypeFilterProps) => {
  const buttonVariants = {
    initial: { opacity: 0, y: 5 },
    animate: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: {
        delay: i * 0.05,
        duration: 0.2,
      },
    }),
    hover: { scale: 1.02 },
    tap: { scale: 0.98 },
  };

  return (
    <Disclosure as="div" className="bg-gray-800 rounded-lg mb-4" defaultOpen={true}>
      {({ open }) => (
        <>
          <DisclosureButton className="w-full px-4 py-3 flex justify-between items-center text-left">
            <h2 className="text-xl font-semibold text-white">Type</h2>
            <motion.div animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.2 }}>
              <ChevronDown className="h-5 w-5 text-gray-400" />
            </motion.div>
          </DisclosureButton>

          <DisclosurePanel className="px-4 pb-4">
            <div className="space-y-2">
              <motion.div
                initial="initial"
                animate="animate"
                custom={0}
                variants={buttonVariants}
                whileHover="hover"
                whileTap="tap"
              >
                <FilterButton
                  active={filters.typeId === 'all'}
                  label="All Types"
                  count={typeCounts.all || 0}
                  onClick={() => setFilters({ ...filters, typeId: 'all' })}
                />
              </motion.div>

              {collaborationTypes.map((type, index) => (
                <motion.div
                  key={type.id}
                  initial="initial"
                  animate="animate"
                  custom={index + 1}
                  variants={buttonVariants}
                  whileHover="hover"
                  whileTap="tap"
                >
                  <FilterButton
                    active={filters.typeId === type.id}
                    label={type.name}
                    count={typeCounts[type.id] || 0}
                    onClick={() => setFilters({ ...filters, typeId: type.id })}
                  />
                </motion.div>
              ))}
            </div>
          </DisclosurePanel>
        </>
      )}
    </Disclosure>
  );
};
