import { ResourceFilterProps } from './types';
import { motion } from 'motion/react';
import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
} from '@headlessui/react';
import { ChevronDown } from 'lucide-react';
import { FilterButton } from './FilterButton';

type TypeFilterProps = Pick<
  ResourceFilterProps,
  'activeType' | 'setActiveType' | 'typeCounts'
>;

export const TypeFilter = ({
  activeType,
  setActiveType,
  typeCounts,
}: TypeFilterProps) => {
  const buttonVariants = {
    initial: { opacity: 0, y: 5 },
    animate: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: {
        delay: i * 0.1,
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
            <h2 className="text-xl font-semibold text-white">Type</h2>
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
                initial="initial"
                animate="animate"
                custom={0}
                variants={buttonVariants}
                whileHover="hover"
                whileTap="tap"
              >
                <FilterButton
                  active={activeType === 'all'}
                  label="All"
                  count={typeCounts.all}
                  onClick={() => setActiveType('all')}
                />
              </motion.div>

              <motion.div
                initial="initial"
                animate="animate"
                custom={1}
                variants={buttonVariants}
                whileHover="hover"
                whileTap="tap"
              >
                <FilterButton
                  active={activeType === 'game'}
                  label="Games"
                  count={typeCounts.game || 0}
                  onClick={() => setActiveType('game')}
                />
              </motion.div>

              <motion.div
                initial="initial"
                animate="animate"
                custom={2}
                variants={buttonVariants}
                whileHover="hover"
                whileTap="tap"
              >
                <FilterButton
                  active={activeType === 'tool'}
                  label="Tools"
                  count={typeCounts.tool || 0}
                  onClick={() => setActiveType('tool')}
                />
              </motion.div>
            </div>
          </DisclosurePanel>
        </>
      )}
    </Disclosure>
  );
};
