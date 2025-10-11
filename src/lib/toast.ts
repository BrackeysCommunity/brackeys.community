import { toast as sonnerToast } from 'sonner';
import { Toast } from '../components/ui/Toast';
import { ComponentProps } from 'react';

export const toast = {
  success: (
    title: string,
    description?: string,
    action?: ComponentProps<typeof Toast>['action']
  ) => {
    return sonnerToast.custom(id => Toast({ id, title, description, variant: 'success', action }));
  },

  error: (title: string, description?: string, action?: ComponentProps<typeof Toast>['action']) => {
    return sonnerToast.custom(id => Toast({ id, title, description, variant: 'error', action }));
  },

  warning: (
    title: string,
    description?: string,
    action?: ComponentProps<typeof Toast>['action']
  ) => {
    return sonnerToast.custom(id => Toast({ id, title, description, variant: 'warning', action }));
  },

  info: (title: string, description?: string, action?: ComponentProps<typeof Toast>['action']) => {
    return sonnerToast.custom(id => Toast({ id, title, description, variant: 'info', action }));
  },

  message: (title: string, description?: string) =>
    sonnerToast.custom(id => Toast({ id, title, description, variant: 'info' })),

  dismiss: sonnerToast.dismiss,
  dismissAll: () => sonnerToast.dismiss(),
};
