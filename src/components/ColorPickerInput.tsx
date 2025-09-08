import { Disclosure, DisclosureButton, DisclosurePanel } from '@headlessui/react';
import { ChevronDown } from 'lucide-react';
import { useDebounceCallback } from 'usehooks-ts';
import { getColorGradient } from '../lib/colors';
import { ColorPicker } from './ColorPicker';
import { Input } from './ui/Input';
import { cn } from '../lib/utils';

type ColorPickerInputProps = {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  selectedColor: string;
  onColorSelect: (color: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  error?: boolean;
  className?: string;
};

export const ColorPickerInput = ({
  value,
  onChange,
  onBlur,
  selectedColor,
  onColorSelect,
  placeholder = 'Enter your name...',
  autoFocus,
  error,
  className,
}: ColorPickerInputProps) => {
  const debouncedColorSelect = useDebounceCallback((color: string, close: () => void) => {
    onColorSelect(color);
    close();
  }, 400);

  return (
    <Disclosure>
      {({ open }) => (
        <div className="relative">
          <Input
            value={value}
            onChange={onChange}
            onBlur={onBlur}
            placeholder={placeholder}
            autoFocus={autoFocus}
            error={error}
            className={className}
            prefixButton={
              <DisclosureButton
                type="button"
                className="flex items-center gap-2 px-3 hover:bg-white/5 transition-colors h-full"
              >
                <div
                  className="w-6 h-6 rounded-full transition-transform border-2"
                  style={{
                    background: getColorGradient(selectedColor),
                    borderColor: selectedColor,
                    transform: open ? 'scale(0.9)' : 'scale(1)',
                  }}
                />
                <ChevronDown
                  className={cn(
                    'w-3 h-3 text-gray-400 transition-transform duration-200',
                    open && 'scale-y-[-1]'
                  )}
                />
              </DisclosureButton>
            }
          />

          {/* Use transition prop for smoother animations */}
          <DisclosurePanel
            transition
            className={cn(
              'absolute left-0 right-0 mt-2 p-4',
              'bg-gray-700 rounded-lg border border-gray-600',
              'shadow-2xl shadow-black/50',
              'transition duration-200 ease-out',
              'data-[closed]:scale-95 data-[closed]:opacity-0',
              'data-[closed]:-translate-y-2',
              'z-[5]' // Lower z-index to stay below modal header
            )}
          >
            {({ close }) => (
              <>
                <p className="text-xs text-gray-400 mb-3 font-medium">Choose your color</p>
                <ColorPicker
                  selectedColor={selectedColor}
                  onColorSelect={color => {
                    onColorSelect(color);
                    debouncedColorSelect(color, close);
                  }}
                />
              </>
            )}
          </DisclosurePanel>
        </div>
      )}
    </Disclosure>
  );
};
