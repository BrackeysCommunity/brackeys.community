import { motion } from 'motion/react';
import { Check } from 'lucide-react';
import { RAINBOW_PALETTE, getColorGradient } from '../lib/colors';

type ColorPickerProps = {
  selectedColor: string;
  onColorSelect: (color: string) => void;
  className?: string;
};

export const ColorPicker = ({
  selectedColor,
  onColorSelect,
  className = '',
}: ColorPickerProps) => {
  return (
    <div className={`grid grid-cols-6 gap-1 ${className}`}>
      {RAINBOW_PALETTE.map((color, index) => {
        const isSelected = color === selectedColor;

        return (
          <motion.div
            key={color}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: index * 0.02 }}
            className="relative flex items-center justify-center aspect-square"
          >
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onColorSelect(color);
              }}
              className="relative w-10 h-10"
            >
              <motion.div
                className="absolute inset-0 rounded-full"
                style={{
                  background: getColorGradient(color),
                  outline: `2px solid ${color}`,
                  outlineOffset: isSelected ? '2px' : '0px',
                  boxShadow: isSelected
                    ? `0 0 0 3px white, 0 2px 8px rgba(0,0,0,0.3)`
                    : '0 2px 4px rgba(0,0,0,0.2)',
                }}
                initial={false}
                whileHover={{
                  outlineOffset: '2px',
                  transition: { duration: 0.2 },
                }}
                whileTap={{ scale: 0.95 }}
              />

              {isSelected && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <Check
                    size={20}
                    className="text-white drop-shadow-lg"
                    strokeWidth={3}
                  />
                </motion.div>
              )}
            </button>
          </motion.div>
        );
      })}
    </div>
  );
};
