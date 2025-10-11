import { useState, ReactNode } from 'react';
import {
  LayoutProps,
  Provider,
  useLayout,
  useLayoutProps,
  defaultLayoutProps,
} from './layoutContext';

export { useLayout, useLayoutProps, defaultLayoutProps };
export type { LayoutProps };

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
