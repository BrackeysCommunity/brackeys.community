import { useState, ReactNode } from 'react';
import { LayoutProps, Provider } from './layoutContext';

export const LayoutProvider = ({ children }: { children: ReactNode }) => {
  const [layoutProps, setLayoutProps] = useState<LayoutProps>({
    showFooter: true,
    showHeader: true,
    containerized: true,
    mainClassName: 'px-4 pt-8',
    fullHeight: false,
  });

  return <Provider value={{ layoutProps, setLayoutProps }}>{children}</Provider>;
};
