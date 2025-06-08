import { Button as HeadlessButton } from '@headlessui/react';
import { ReactNode, useState } from 'react';
import { cva, VariantProps } from 'class-variance-authority';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'transition-all focus:ring-2 focus:ring-offset-2',
  {
    variants: {
      variant: {
        primary: 'focus:outline-none bg-brackeys-purple-600 hover:bg-brackeys-purple-700 text-white focus:ring-brackeys-purple-500 focus:ring-offset-brackeys-purple-800',
        secondary: 'focus:outline-none bg-gray-700 hover:bg-gray-600 text-white border border-gray-600 focus:ring-gray-500 focus:ring-offset-gray-800',
        success: 'focus:outline-none bg-green-600 hover:bg-green-700 text-white focus:ring-green-500 focus:ring-offset-green-800',
        danger: 'focus:outline-none bg-red-600 hover:bg-red-700 text-white focus:ring-red-500 focus:ring-offset-red-800',
        ghost: 'bg-transparent hover:bg-gray-700 text-gray-300 hover:text-white focus:!ring-0 focus:!ring-offset-0 focus:!outline-2 focus:!outline-offset-2 focus:!outline-gray-500',
        card: 'focus:outline-none border bg-gray-700',
        checkbox: 'focus:outline-none bg-gray-700 hover:bg-gray-600',
        'checkbox-card': 'focus:outline-none border bg-gray-700',
      },
      size: {
        icon: 'p-1.5',
        sm: 'px-3 py-2 text-sm',
        md: 'px-4 py-3',
        lg: 'px-6 py-4 text-lg',
        card: 'p-4',
      },
      layout: {
        default: 'flex items-center justify-center space-x-2',
        horizontal: 'flex flex-col items-center text-center',
        vertical: 'flex items-start space-x-3',
      },
      fullWidth: {
        true: 'w-full',
      },
      disabled: {
        true: 'opacity-50 cursor-not-allowed',
      },
      selected: {
        true: '',
      },
      colorizeHover: {
        true: '',
      },
      cardColor: {
        green: 'data-[selected=true]:border-green-500 data-[selected=true]:bg-green-500/10 focus:ring-green-500 focus:ring-offset-green-800',
        yellow: 'data-[selected=true]:border-yellow-500 data-[selected=true]:bg-yellow-500/10 focus:ring-yellow-500 focus:ring-offset-yellow-800',
        purple: 'data-[selected=true]:border-brackeys-purple-500 data-[selected=true]:bg-brackeys-purple-500/10 focus:ring-brackeys-purple-500 focus:ring-offset-brackeys-purple-800',
        blue: 'data-[selected=true]:border-blue-500 data-[selected=true]:bg-blue-500/10 focus:ring-blue-500 focus:ring-offset-blue-800',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
      layout: 'default',
      fullWidth: false,
      disabled: false,
      selected: false,
      colorizeHover: false,
    },
    compoundVariants: [
      // Card and checkbox-card variants always use rounded-lg
      {
        variant: ['card', 'checkbox-card'],
        className: 'rounded-lg border-gray-600',
      },
      // Regular buttons use rounded-lg
      {
        variant: ['primary', 'secondary', 'danger', 'ghost', 'success'],
        className: 'rounded-lg',
      },
      // Checkbox variant styling
      {
        variant: 'checkbox',
        className: 'rounded-md',
      },
      // Selected card states
      {
        variant: ['card', 'checkbox-card'],
        selected: true,
        className: 'border-opacity-100',
      },
      // Default hover for card variants when colorizeHover is false
      {
        variant: ['card', 'checkbox-card'],
        colorizeHover: false,
        className: 'hover:border-gray-500',
      },
      // Add hover styles for card variants when colorizeHover is true
      {
        variant: ['card', 'checkbox-card'],
        colorizeHover: true,
        className: 'hover:border-opacity-100 hover:bg-opacity-10',
      },
      {
        variant: ['card', 'checkbox-card'],
        colorizeHover: true,
        cardColor: 'green',
        className: 'hover:border-green-500 hover:bg-green-500/10',
      },
      {
        variant: ['card', 'checkbox-card'],
        colorizeHover: true,
        cardColor: 'yellow',
        className: 'hover:border-yellow-500 hover:bg-yellow-500/10',
      },
      {
        variant: ['card', 'checkbox-card'],
        colorizeHover: true,
        cardColor: 'purple',
        className: 'hover:border-brackeys-purple-500 hover:bg-brackeys-purple-500/10',
      },
      {
        variant: ['card', 'checkbox-card'],
        colorizeHover: true,
        cardColor: 'blue',
        className: 'hover:border-blue-500 hover:bg-blue-500/10',
      },
    ],
  }
);

const colorStyles = {
  purple: {
    selected: {
      border: 'border-brackeys-purple-500',
      bg: 'bg-brackeys-purple-500/10',
      text: 'text-brackeys-purple-300',
      textLight: 'text-brackeys-purple-100',
      icon: 'text-brackeys-purple-400',
      iconBg: 'bg-brackeys-purple-600'
    },
    hover: {
      border: 'border-brackeys-purple-500',
      bg: 'bg-brackeys-purple-500/10'
    }
  },
  blue: {
    selected: {
      border: 'border-blue-500',
      bg: 'bg-blue-500/10',
      text: 'text-blue-300',
      textLight: 'text-blue-100',
      icon: 'text-blue-400',
      iconBg: 'bg-blue-600'
    },
    hover: {
      border: 'hover:border-blue-500',
      bg: 'hover:bg-blue-500/10'
    }
  },
  green: {
    selected: {
      border: 'border-green-500',
      bg: 'bg-green-500/10',
      text: 'text-green-300',
      textLight: 'text-green-100',
      icon: 'text-green-400',
      iconBg: 'bg-green-600'
    },
    hover: {
      border: 'hover:border-green-500',
      bg: 'hover:bg-green-500/10'
    }
  },
  yellow: {
    selected: {
      border: 'border-yellow-500',
      bg: 'bg-yellow-500/10',
      text: 'text-yellow-300',
      textLight: 'text-yellow-100',
      icon: 'text-yellow-400',
      iconBg: 'bg-yellow-600'
    },
    hover: {
      border: 'hover:border-yellow-500',
      bg: 'hover:bg-yellow-500/10'
    }
  }
};

type ButtonProps = VariantProps<typeof buttonVariants> & {
  children?: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  loading?: boolean;
  className?: string;
  icon?: ReactNode;
  title?: string;
  subtitle?: string;
  showCheckmark?: boolean;
}

export const Button = ({
  children,
  onClick,
  type = 'button',
  variant,
  size,
  layout,
  disabled = false,
  loading = false,
  className = '',
  fullWidth,
  selected = false,
  cardColor,
  icon,
  title,
  subtitle,
  showCheckmark = true,
  colorizeHover = false,
}: ButtonProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const isCard = variant === 'card' || variant === 'checkbox-card';
  const isCheckbox = variant === 'checkbox' || variant === 'checkbox-card';

  // For card modes with specific content
  if (isCard && (icon || title || subtitle)) {
    const shouldApplyColoredStyles = selected || (colorizeHover && isHovered && cardColor);

    return (
      <HeadlessButton
        type={type}
        onClick={onClick}
        disabled={disabled || loading}
        data-selected={selected}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={buttonVariants({
          variant,
          size: 'card',
          layout: layout || 'horizontal',
          fullWidth,
          disabled: disabled || loading,
          selected,
          colorizeHover,
          cardColor,
          className,
        })}
      >
        {loading ? (
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
        ) : (
          <>
            {layout === 'vertical' ? (
              <>
                {icon && (
                  <div className={`p-2 rounded-lg ${selected || (colorizeHover && cardColor)
                    ? colorStyles[cardColor || 'purple'].selected.iconBg
                    : 'bg-gray-600'}`}>
                    {icon}
                  </div>
                )}
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    {title && (
                      <h3 className={cn(
                        "font-medium",
                        shouldApplyColoredStyles
                          ? colorStyles[cardColor || 'purple'].selected.text
                          : 'text-white'
                      )}>
                        {title}
                      </h3>
                    )}
                    {isCheckbox && selected && showCheckmark && (
                      <Check className={`w-5 h-5 ${colorStyles[cardColor || 'purple'].selected.icon}`} />
                    )}
                  </div>
                  {subtitle && (
                    <p className={`text-sm mt-1 text-left ${shouldApplyColoredStyles
                      ? colorStyles[cardColor || 'purple'].selected.textLight
                      : 'text-gray-400'}`}>{subtitle}</p>
                  )}
                </div>
              </>
            ) : (
              <>
                {icon && (
                  <div className={`w-6 h-6 mx-auto mb-2 ${shouldApplyColoredStyles
                    ? colorStyles[cardColor || 'purple'].selected.icon
                    : 'text-gray-400'}`}>
                    {icon}
                  </div>
                )}
                {title && (
                  <p className={`font-medium ${shouldApplyColoredStyles
                    ? colorStyles[cardColor || 'purple'].selected.text
                    : 'text-gray-300'}`}>
                    {title}
                  </p>
                )}
                {subtitle && (
                  <p className={`text-sm text-left text-gray-500 mt-1 ${shouldApplyColoredStyles
                    ? colorStyles[cardColor || 'purple'].selected.textLight
                    : 'text-gray-300'}`}>{subtitle}</p>
                )}
                {isCheckbox && selected && showCheckmark && layout === 'horizontal' && (
                  <Check className={`w-4 h-4 mt-2 ${colorStyles[cardColor || 'purple'].selected.icon}`} />
                )}
              </>
            )}
          </>
        )}
      </HeadlessButton>
    );
  }

  // Default button behavior
  return (
    <HeadlessButton
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      data-selected={selected}
      className={buttonVariants({
        variant,
        size,
        layout,
        fullWidth,
        disabled: disabled || loading,
        selected,
        className
      })}
    >
      {loading && (
        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
      )}
      {children}
    </HeadlessButton>
  );
}; 