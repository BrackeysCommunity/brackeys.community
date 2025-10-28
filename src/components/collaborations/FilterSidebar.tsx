import { motion } from 'motion/react';
import { cn } from '../../lib/utils';
import { HiringStatusFilter } from './HiringStatusFilter';
import { SortFilter } from './SortFilter';
import { TypeFilter } from './TypeFilter';
import type {
  CollaborationFilters,
  CollaborationType,
  HiringStatus,
} from './types';

type FilterSidebarProps = {
  filters: CollaborationFilters;
  setFilters: (filters: CollaborationFilters) => void;
  collaborationTypes: CollaborationType[];
  hiringStatuses: HiringStatus[];
  typeCounts: Record<string, number>;
  hiringStatusCounts: Record<string, number>;
};

export const FilterSidebar = ({
  filters,
  setFilters,
  collaborationTypes,
  hiringStatuses,
  typeCounts,
  hiringStatusCounts,
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
        filters={filters}
        setFilters={setFilters}
        collaborationTypes={collaborationTypes}
        typeCounts={typeCounts}
      />

      <HiringStatusFilter
        filters={filters}
        setFilters={setFilters}
        hiringStatuses={hiringStatuses}
        hiringStatusCounts={hiringStatusCounts}
      />

      <SortFilter filters={filters} setFilters={setFilters} />

      {/* Active Filters Summary */}
      {(filters.typeId !== 'all' || filters.hiringStatusId !== 'all') && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gray-800 rounded-lg p-4"
        >
          <button
            type="button"
            onClick={() =>
              setFilters({
                ...filters,
                typeId: 'all',
                hiringStatusId: 'all',
                statusId: 'all',
              })
            }
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Clear all filters
          </button>
        </motion.div>
      )}
    </div>
  </motion.div>
);
