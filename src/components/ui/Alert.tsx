import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, CheckCircle, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

const alertVariants = cva('flex p-4 rounded-md', {
  variants: {
    variant: {
      success: 'bg-green-900/20 border border-green-800',
      error: 'bg-red-900/20 border border-red-800',
      warning: 'bg-yellow-900/20 border border-yellow-800',
      info: 'bg-blue-900/20 border border-blue-800',
    },
  },
  defaultVariants: {
    variant: 'info',
  },
});

const iconVariants = cva('h-5 w-5 shrink-0', {
  variants: {
    variant: {
      success: 'text-green-400',
      error: 'text-red-400',
      warning: 'text-yellow-400',
      info: 'text-blue-400',
    },
  },
  defaultVariants: {
    variant: 'info',
  },
});

const titleVariants = cva('text-sm font-medium', {
  variants: {
    variant: {
      success: 'text-green-200',
      error: 'text-red-200',
      warning: 'text-yellow-200',
      info: 'text-blue-200',
    },
  },
  defaultVariants: {
    variant: 'info',
  },
});

const descriptionVariants = cva('text-sm', {
  variants: {
    variant: {
      success: 'text-green-300',
      error: 'text-red-300',
      warning: 'text-yellow-300',
      info: 'text-blue-300',
    },
  },
  defaultVariants: {
    variant: 'info',
  },
});

const getIconComponent = (
  variant: 'success' | 'error' | 'warning' | 'info' | null,
) => {
  const icons = {
    success: CheckCircle,
    error: XCircle,
    warning: AlertTriangle,
    info: Info,
  };
  return icons[variant || 'info'];
};

type AlertProps = VariantProps<typeof alertVariants> & {
  title?: string;
  description?: string;
  children?: ReactNode;
  className?: string;
};

export const Alert = ({
  variant = 'info',
  title,
  description,
  children,
  className,
}: AlertProps) => {
  const Icon = getIconComponent(variant);

  return (
    <div className={cn(alertVariants({ variant }), className)}>
      <div className="shrink-0">
        <Icon className={iconVariants({ variant })} />
      </div>
      <div className="ml-3 flex-1">
        {title && <h3 className={titleVariants({ variant })}>{title}</h3>}
        {description && (
          <div
            className={cn(descriptionVariants({ variant }), title && 'mt-2')}
          >
            <p>{description}</p>
          </div>
        )}
        {children && (
          <div
            className={cn(
              descriptionVariants({ variant }),
              (title || description) && 'mt-2',
            )}
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
};
