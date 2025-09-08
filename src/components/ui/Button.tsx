import { Button as HeadlessButton } from '@headlessui/react';
import { ReactNode, useState } from 'react';
import { cva, VariantProps } from 'class-variance-authority';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { motion, MotionProps } from 'motion/react';
import { Link } from '@tanstack/react-router';

const buttonVariants = cva(
  'transition-all focus:outline-none outline-2 -outline-offset-1 focus:ring-2 focus:ring-offset-2 inline-flex items-center justify-center leading-none',
  {
    variants: {
      variant: {
        primary: 'outline-brackeys-purple-500 bg-brackeys-purple-600 hover:bg-brackeys-purple-500 focus:ring-brackeys-purple-500 focus:ring-offset-brackeys-purple-800 text-white',
        secondary: 'outline-gray-600 bg-gray-700 hover:bg-gray-600 focus:ring-gray-500 focus:ring-offset-gray-800 text-white',
        success: 'outline-green-500 bg-green-600 hover:bg-green-500 text-white focus:ring-green-500 focus:ring-offset-green-800',
        danger: 'outline-red-500 bg-red-600 hover:bg-red-500 text-white focus:ring-red-500 focus:ring-offset-red-800',
        ghost: 'bg-transparent outline-none hover:bg-gray-700 text-gray-300 hover:text-white focus:!ring-0 focus:!ring-offset-0',
        card: 'outline-gray-600 bg-gray-700 focus:ring-gray-500 focus:ring-offset-gray-800 rounded-lg',
        checkbox: 'bg-gray-700 hover:bg-gray-600 rounded-md',
        'checkbox-card': 'focus:outline-2 outline-gray-600 rounded-lg',
      },
      size: {
        icon: 'p-1.5',
        sm: 'px-3 py-2 text-sm',
        md: 'px-4 py-3',
        lg: 'px-6 py-4',
        card: 'p-4',
      },
      layout: {
        default: 'space-x-2',
        vertical: 'flex flex-col items-center text-center',
        horizontal: 'flex items-start space-x-3',
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
        green: 'data-[selected=true]:outline-green-500 data-[selected=true]:bg-green-500/10 focus:ring-green-500 focus:ring-offset-green-800',
        yellow: 'data-[selected=true]:outline-yellow-500 data-[selected=true]:bg-yellow-500/10 focus:ring-yellow-500 focus:ring-offset-yellow-800',
        purple: 'data-[selected=true]:outline-brackeys-purple-500 data-[selected=true]:bg-brackeys-purple-500/10 focus:ring-brackeys-purple-500 focus:ring-offset-brackeys-purple-800',
        blue: 'data-[selected=true]:outline-blue-500 data-[selected=true]:bg-blue-500/10 focus:ring-blue-500 focus:ring-offset-blue-800',
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
      // Default focus ring for checkbox-card when no cardColor is specified
      {
        variant: 'checkbox-card',
        cardColor: undefined,
        className: 'focus:ring-gray-500 focus:ring-offset-gray-800',
      },
    ],
  }
);

const colorStyles = {
  purple: {
    selected: {
      outline: 'outline-brackeys-purple-500',
      bg: 'bg-brackeys-purple-500/10',
      text: 'text-brackeys-purple-300',
      textLight: 'text-brackeys-purple-100',
      icon: 'text-brackeys-purple-400',
      iconBg: 'bg-brackeys-purple-600'
    },
    hover: {
      outline: 'outline-brackeys-purple-500',
      bg: 'bg-brackeys-purple-500/10'
    }
  },
  blue: {
    selected: {
      outline: 'outline-blue-500',
      bg: 'bg-blue-500/10',
      text: 'text-blue-300',
      textLight: 'text-blue-100',
      icon: 'text-blue-400',
      iconBg: 'bg-blue-600'
    },
    hover: {
      outline: 'hover:outline-blue-500',
      bg: 'hover:bg-blue-500/10'
    }
  },
  green: {
    selected: {
      outline: 'outline-green-500',
      bg: 'bg-green-500/10',
      text: 'text-green-300',
      textLight: 'text-green-100',
      icon: 'text-green-400',
      iconBg: 'bg-green-600'
    },
    hover: {
      outline: 'hover:outline-green-500',
      bg: 'hover:bg-green-500/10'
    }
  },
  yellow: {
    selected: {
      outline: 'outline-yellow-500',
      bg: 'bg-yellow-500/10',
      text: 'text-yellow-300',
      textLight: 'text-yellow-100',
      icon: 'text-yellow-400',
      iconBg: 'bg-yellow-600'
    },
    hover: {
      outline: 'hover:outline-yellow-500',
      bg: 'hover:bg-yellow-500/10'
    }
  }
};

type ButtonProps = Omit<MotionProps, 'layout'> & VariantProps<typeof buttonVariants> & {
  children?: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  loading?: boolean;
  className?: string;
  icon?: ReactNode;
  title?: string;
  subtitle?: string;
  showCheckmark?: boolean;
  href?: string;
  to?: string;
  target?: string;
  rel?: string;
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
  fullWidth,
  selected = false,
  cardColor,
  icon,
  title,
  subtitle,
  showCheckmark = true,
  colorizeHover = false,
  href,
  to,
  target,
  rel,
  ...props
}: ButtonProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const isCard = variant?.includes('card');
  const isCheckbox = variant?.includes('checkbox');
  const isDisabled = disabled || loading;

  // If href, to, target, or rel is provided, use the Link component
  if (href || to || rel) {
    return (
      <Link
        href={href}
        to={to}
        target={target}
        rel={rel}
        className={buttonVariants({
          variant,
          size,
          layout,
          fullWidth,
          disabled: isDisabled,
          selected,
          className: props.className,
        })}
      >
        {children}
      </Link>
    );
  }

  // For card modes with specific content
  if (isCard && (icon || title || subtitle)) {
    const shouldApplyColoredStyles = selected || (colorizeHover && isHovered && cardColor);

    return (
      <HeadlessButton
        as={motion.button}
        {...props}
        type={type}
        onClick={onClick}
        disabled={isDisabled}
        data-selected={selected}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={buttonVariants({
          variant,
          size: 'card',
          layout: layout || 'vertical',
          fullWidth,
          disabled: isDisabled,
          selected,
          colorizeHover,
          cardColor,
          className: props.className,
        })}
      >
        {loading ? (
          <motion.div
            className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          />
        ) : (
          <>
            {layout === 'horizontal' ? (
              <>
                {icon && (
                  <motion.div
                    className={`p-3 rounded-lg ${selected || (colorizeHover && cardColor)
                      ? colorStyles[cardColor || 'purple'].selected.iconBg
                      : 'bg-gray-600'}`}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.1 }}
                  >
                    <motion.div
                      className={shouldApplyColoredStyles
                        ? colorStyles[cardColor || 'purple'].selected.icon
                        : 'text-gray-400'}
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 }}
                    >
                      {icon}
                    </motion.div>
                  </motion.div>
                )}
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    {title && (
                      <motion.h3
                        className={cn(
                          "font-medium",
                          shouldApplyColoredStyles
                            ? colorStyles[cardColor || 'purple'].selected.text
                            : 'text-white'
                        )}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.15 }}
                      >
                        {title}
                      </motion.h3>
                    )}
                    {isCheckbox && selected && showCheckmark && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ type: 'spring', stiffness: 400, delay: 0.3 }}
                      >
                        <Check className={`w-5 h-5 ${colorStyles[cardColor || 'purple'].selected.icon}`} />
                      </motion.div>
                    )}
                  </div>
                  {subtitle && (
                    <motion.p
                      className={`text-sm mt-1 text-left ${shouldApplyColoredStyles
                        ? colorStyles[cardColor || 'purple'].selected.textLight
                        : 'text-gray-400'}`}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.25 }}
                    >
                      {subtitle}
                    </motion.p>
                  )}
                </div>
              </>
            ) : (
              <>
                {icon && (
                  <motion.div
                    className={`w-6 h-6 mx-auto mb-2 ${shouldApplyColoredStyles
                      ? colorStyles[cardColor || 'purple'].selected.icon
                      : 'text-gray-400'}`}
                    initial={{ opacity: 0, scale: 0.8, y: -10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 300, delay: 0.1 }}
                  >
                    {icon}
                  </motion.div>
                )}
                {title && (
                  <motion.p
                    className={`font-medium ${shouldApplyColoredStyles
                      ? colorStyles[cardColor || 'purple'].selected.text
                      : 'text-gray-300'}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.15 }}
                  >
                    {title}
                  </motion.p>
                )}
                {subtitle && (
                  <motion.p
                    className={`text-sm text-center mt-1 ${shouldApplyColoredStyles
                      ? colorStyles[cardColor || 'purple'].selected.textLight
                      : 'text-gray-400'}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.25 }}
                  >
                    {subtitle}
                  </motion.p>
                )}
                {isCheckbox && selected && showCheckmark && layout === 'vertical' && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.5, y: 10 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 400, delay: 0.3 }}
                  >
                    <Check className={`w-4 h-4 mt-2 ${colorStyles[cardColor || 'purple'].selected.icon}`} />
                  </motion.div>
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
      as={motion.button}
      {...props}
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      data-selected={selected}
      className={buttonVariants({
        variant,
        size,
        layout,
        fullWidth,
        disabled: isDisabled,
        selected,
        className: props.className,
      })}
    >
      {loading && (
        <motion.div
          className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        />
      )}
      {icon && !loading && (
        <motion.span
          className='mr-2'
          initial={{ opacity: 0, scale: 0.6, y: -10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
          {icon}
        </motion.span>
      )}
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        {children}
      </motion.span>
    </HeadlessButton>
  );
}; 