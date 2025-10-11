import { motion } from 'motion/react';
import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
} from '@headlessui/react';
import { ChevronDown, Clock, TrendingUp, MessageCircle } from 'lucide-react';
import { FilterButton } from './FilterButton';
import type { CollaborationFilters } from './types';

type SortFilterProps = {
  filters: CollaborationFilters;
  setFilters: (filters: CollaborationFilters) => void;
};

const sortOptions = [
  {
    value: 'recent',
    label: 'Most Recent',
    icon: Clock,
    iconColor: 'text-blue-400',
  },
  {
    value: 'popular',
    label: 'Most Popular',
    icon: TrendingUp,
    iconColor: 'text-green-400',
  },
  {
    value: 'responses',
    label: 'Most Responses',
    icon: MessageCircle,
    iconColor: 'text-purple-400',
  },
] as const;

export const SortFilter = ({ filters, setFilters }: SortFilterProps) => {
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
    <Disclosure
      as="div"
      className="bg-gray-800 rounded-lg mb-4"
      defaultOpen={true}
    >
      {({ open }) => (
        <>
          <DisclosureButton className="w-full px-4 py-3 flex justify-between items-center text-left">
            <h2 className="text-xl font-semibold text-white">Sort By</h2>
            <motion.div
              animate={{ rotate: open ? 0 : -90 }}
              transition={{ duration: 0.2 }}
            >
              <ChevronDown className="h-5 w-5 text-gray-400" />
            </motion.div>
          </DisclosureButton>

          <DisclosurePanel className="px-4 pb-4">
            <div className="space-y-2">
              {sortOptions.map((option, index) => (
                <motion.div
                  key={option.value}
                  initial="initial"
                  animate="animate"
                  custom={index}
                  variants={buttonVariants}
                  whileHover="hover"
                  whileTap="tap"
                >
                  <FilterButton
                    active={filters.sortBy === option.value}
                    label={option.label}
                    count={0}
                    onClick={() =>
                      setFilters({ ...filters, sortBy: option.value })
                    }
                    icon={option.icon}
                    iconColor={option.iconColor}
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
