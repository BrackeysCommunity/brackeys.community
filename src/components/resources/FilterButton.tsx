import { motion } from 'motion/react';
import type { ComponentType } from 'react';
import { cn } from '../../lib/utils';

type FilterButtonProps = {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
  icon?: ComponentType<{ className?: string }>;
  iconColor?: string;
};

export const FilterButton = ({
  active,
  label,
  count,
  onClick,
  icon: Icon,
  iconColor,
}: FilterButtonProps) => {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        'px-3 py-2 rounded-md flex justify-between items-center gap-2',
        active
          ? 'bg-gray-700 text-white'
          : 'bg-gray-900/50 text-gray-400 hover:bg-gray-700/50',
      )}
    >
      <div className="flex items-center gap-2">
        {Icon && <Icon className={cn('h-4 w-4', iconColor)} />}
        <span>{label}</span>
      </div>
      <span className="bg-gray-900 text-gray-400 text-xs px-2 py-1 rounded-full">
        {count}
      </span>
    </motion.button>
  );
};
