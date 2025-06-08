import { createContext, useContext, type ReactNode } from 'react';

interface ModalContextValue {
  setActions: (actions: ReactNode) => void;
  onBack?: () => void;
  setTitle: (title: string) => void;
  resetTitle: () => void;
}

const ModalContext = createContext<ModalContextValue | null>(null);

export const useModalContext = () => {
  const context = useContext(ModalContext);
  return context || {
    setActions: () => { },
    setTitle: () => { },
    resetTitle: () => { },
    onBack: undefined
  };
};

export const ModalProvider = ModalContext.Provider; 