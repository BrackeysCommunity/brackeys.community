import { Input as HeadlessInput } from '@headlessui/react';
import { forwardRef, useState } from 'react';
import { Eye, EyeOff, LucideIcon } from 'lucide-react';

interface InputProps {
  type?: 'text' | 'email' | 'password' | 'number';
  value?: string | number;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  autoFocus?: boolean;
  maxLength?: number;
  min?: number;
  error?: boolean;
  prefixIcon?: LucideIcon;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({
  type = 'text',
  value,
  onChange,
  onBlur,
  placeholder,
  disabled = false,
  className = '',
  autoFocus = false,
  maxLength,
  min,
  error = false,
  prefixIcon: PrefixIcon,
}, ref) => {
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  const isPasswordType = type === 'password';
  const inputType = isPasswordType && isPasswordVisible ? 'text' : type;

  const togglePasswordVisibility = () => {
    setIsPasswordVisible(!isPasswordVisible);
  };

  return (
    <div className="relative">
      {PrefixIcon && (
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          <PrefixIcon className="w-5 h-5" />
        </div>
      )}

      <HeadlessInput
        ref={ref}
        type={inputType}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        min={min}
        data-autofocus={autoFocus}
        className={`
          w-full py-3 
          ${PrefixIcon ? 'pl-11' : 'pl-4'}
          ${isPasswordType ? 'pr-12' : 'pr-4'}
          bg-gray-700 
          border ${error ? 'border-red-500' : 'border-gray-600'}
          rounded-lg 
          text-white text-sm
          placeholder-gray-400 
          focus:outline-none 
          focus:ring-2 
          focus:ring-brackeys-purple-500
          disabled:opacity-50 
          disabled:cursor-not-allowed
          ${className}
        `}
      />

      {isPasswordType && (
        <button
          type="button"
          onClick={togglePasswordVisibility}
          disabled={disabled}
          className="
            absolute right-3 top-1/2 -translate-y-1/2
            text-gray-400 hover:text-gray-300
            focus:outline-none focus:text-gray-300
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors duration-200
          "
          aria-label={isPasswordVisible ? 'Hide password' : 'Show password'}
        >
          {isPasswordVisible ? (
            <EyeOff className="w-5 h-5" />
          ) : (
            <Eye className="w-5 h-5" />
          )}
        </button>
      )}
    </div>
  );
});

Input.displayName = 'Input'; 