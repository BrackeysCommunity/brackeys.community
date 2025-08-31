import { Link, LinkProps } from '@tanstack/react-router';
import { cva, VariantProps } from 'class-variance-authority';
import { ReactNode } from 'react';
import { cn } from '../../lib/utils';

const linkButtonVariants = cva(
  'transition-all focus:ring-2 focus:ring-offset-2 inline-flex items-center justify-center leading-none rounded-md font-medium',
  {
    variants: {
      variant: {
        primary: 'focus:outline-none bg-brackeys-purple-600 hover:bg-brackeys-purple-700 text-white focus:ring-brackeys-purple-500 focus:ring-offset-brackeys-purple-800',
        secondary: 'focus:outline-none bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-600 focus:ring-gray-500 focus:ring-offset-gray-800',
        ghost: 'bg-transparent hover:bg-gray-700 text-gray-300 hover:text-white focus:!ring-0 focus:!ring-offset-0',
      },
      size: {
        sm: 'px-3 py-2 text-sm',
        md: 'px-4 py-3 text-base',
        lg: 'px-6 py-3 text-base',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

type LinkButtonProps = Omit<LinkProps, 'className'> & VariantProps<typeof linkButtonVariants> & {
  children: ReactNode;
  className?: string;
};

export const LinkButton = ({
  variant,
  size,
  className,
  children,
  ...props
}: LinkButtonProps) => {
  return (
    <Link
      {...props}
      className={cn(linkButtonVariants({ variant, size }), className)}
    >
      {children}
    </Link>
  );
};
