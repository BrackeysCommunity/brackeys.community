import { toast as sonnerToast } from 'sonner';
import { CheckCircle, XCircle, Info, AlertTriangle, X } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const toastVariants = cva(
  'flex items-start gap-3 p-4 rounded-lg shadow-lg backdrop-blur-sm border w-full max-w-[400px]',
  {
    variants: {
      variant: {
        success: 'bg-gray-800/95 border-green-500/50',
        error: 'bg-gray-800/95 border-red-500/50',
        warning: 'bg-gray-800/95 border-yellow-500/50',
        info: 'bg-gray-800/95 border-brackeys-purple-500/50',
      },
    },
    defaultVariants: {
      variant: 'info',
    },
  }
);

const iconVariants = cva('h-5 w-5 mt-0.5 flex-shrink-0', {
  variants: {
    variant: {
      success: 'text-green-500',
      error: 'text-red-500',
      warning: 'text-yellow-500',
      info: 'text-brackeys-purple-500',
    },
  },
  defaultVariants: {
    variant: 'info',
  },
});

const titleVariants = cva('text-sm font-medium leading-tight', {
  variants: {
    variant: {
      success: 'text-green-100',
      error: 'text-red-100',
      warning: 'text-yellow-100',
      info: 'text-brackeys-purple-100',
    },
  },
  defaultVariants: {
    variant: 'info',
  },
});

const descriptionVariants = cva('mt-1 text-sm leading-relaxed', {
  variants: {
    variant: {
      success: 'text-green-200/80',
      error: 'text-red-200/80',
      warning: 'text-yellow-200/80',
      info: 'text-brackeys-purple-200/80',
    },
  },
  defaultVariants: {
    variant: 'info',
  },
});

const contentVariants = cva('flex-1 min-w-0', {
  variants: {
    variant: {
      success: 'pt-0.75',
      error: 'pt-0.5',
      warning: 'pt-0.75',
      info: 'pt-0.75',
    },
  },
  defaultVariants: {
    variant: 'info',
  },
});

const getIconComponent = (variant: 'success' | 'error' | 'warning' | 'info') => {
  const icons = {
    success: CheckCircle,
    error: XCircle,
    warning: AlertTriangle,
    info: Info,
  };
  return icons[variant];
};

export interface ToastProps extends VariantProps<typeof toastVariants> {
  id: string | number;
  title: string;
  description?: string;
  variant: 'success' | 'error' | 'warning' | 'info';
  action?: {
    label: string;
    onClick: () => void;
  };
}

export const Toast = ({ id, title, description, variant = 'info', action }: ToastProps) => {
  const Icon = getIconComponent(variant);

  return (
    <div className={toastVariants({ variant })}>
      <Icon className={iconVariants({ variant })} />

      <div className={contentVariants({ variant })}>
        <p className={titleVariants({ variant })}>
          {title}
        </p>
        {description && (
          <p className={descriptionVariants({ variant })}>
            {description}
          </p>
        )}
        {action && (
          <button
            className={cn(
              'mt-3 inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              'bg-gray-700/50 hover:bg-gray-600/50 text-gray-200 hover:text-white',
              'border border-gray-600/50 hover:border-gray-500/50'
            )}
            onClick={() => {
              action.onClick();
              sonnerToast.dismiss(id);
            }}
          >
            {action.label}
          </button>
        )}
      </div>

      <button
        className="flex-shrink-0 text-gray-400 hover:text-gray-200 transition-colors p-1 hover:bg-gray-700/50 rounded"
        onClick={() => sonnerToast.dismiss(id)}
        aria-label="Dismiss notification"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}; 