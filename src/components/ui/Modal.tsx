import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { motion } from 'framer-motion';
import { ArrowLeft, X } from 'lucide-react';
import { type ReactNode, useState, useCallback } from 'react';
import { useRouter } from '@tanstack/react-router';
import { ModalProvider } from '../../context/modalContext';
import { Button } from './Button';
import { cn } from '../../lib/utils';

interface ModalProps {
  isOpen: boolean;
  onClose?: () => void;
  onBack?: () => void;
  title?: string;
  children: ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  showCloseButton?: boolean;
  actions?: ReactNode;
  allowEscape?: boolean;
}

const maxWidthClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
};

export const Modal = ({
  isOpen,
  onClose,
  onBack,
  title,
  children,
  maxWidth = 'lg',
  showCloseButton = true,
  actions: externalActions,
  allowEscape = false,
}: ModalProps) => {
  const router = useRouter();
  const [internalActions, setInternalActions] = useState<ReactNode>(null);
  const [internalTitle, setInternalTitle] = useState<string | undefined>(title);

  const actions = externalActions || internalActions;

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else if (allowEscape) {
      router.navigate({ to: '/' });
    }
  };

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else if (onClose) {
      onClose();
    } else if (allowEscape) {
      router.navigate({ to: '/' });
    }
  };

  const setActions = useCallback((newActions: ReactNode) => {
    setInternalActions(newActions);
  }, []);

  const setTitle = useCallback((newTitle: string) => {
    setInternalTitle(newTitle);
  }, [setInternalTitle]);

  const resetTitle = useCallback(() => {
    setInternalTitle(title);
  }, [setInternalTitle, title]);

  return (
    <Dialog
      static
      open={isOpen}
      onClose={handleClose}
      className="relative z-50"
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50"
      />

      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel
          as={motion.div}
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className={`
            ${maxWidthClasses[maxWidth]} 
            w-full 
            bg-gray-800 
            border border-gray-700 rounded-lg 
            shadow-xl 
            relative 
            max-h-[calc(100vh-2rem)]
            flex flex-col
            overflow-hidden
          `}
        >
          {/* Content with custom scrollbar */}
          <div className={`
            flex-1 
            overflow-y-auto 
            custom-scrollbar 
            ${actions ? '[&>*:not(:last-child)]:px-6' : 'px-6 pb-6'}
          `}>
            {(internalTitle || (showCloseButton && (onClose || onBack || allowEscape))) && (
              <div className={cn("sticky top-0 flex items-center justify-between py-4 bg-gradient-to-b from-gray-800 from-30% to-transparent")}>
                {onBack ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleBack}
                    aria-label="Back"
                  >
                    <ArrowLeft className="w-6 h-6" />
                  </Button>
                  // 36px (w/h-9) is the width of the button
                ) : <div className="w-9 h-9" />}
                {internalTitle && (
                  <DialogTitle className="text-xl font-semibold text-white">
                    {internalTitle}
                  </DialogTitle>
                )}
                {showCloseButton && (onClose || allowEscape) && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleClose}
                    className={cn(!internalTitle && !onBack && "ml-auto")}
                    aria-label="Close"
                  >
                    <X className="w-6 h-6" />
                  </Button>
                )}
              </div>
            )}
            <ModalProvider value={{ setActions, onBack, setTitle, resetTitle }}>
              {children}
            </ModalProvider>
            {/* Actions with fade gradient */}
            {actions && (
              <div className="sticky bottom-0 left-0 right-0">
                <div className="p-6 bg-gradient-to-t from-gray-800 from-75% to-transparent">
                  {actions}
                </div>
              </div>
            )}
          </div>

        </DialogPanel>
      </div>
    </Dialog>
  );
}; 