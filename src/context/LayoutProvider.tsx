import { type ReactNode, useState } from 'react';
import {
  defaultLayoutProps,
  type LayoutProps,
  Provider,
  useLayout,
  useLayoutProps,
} from './layoutContext';

export { useLayout, useLayoutProps, defaultLayoutProps };
export type { LayoutProps };

export const LayoutProvider = ({ children }: { children: ReactNode }) => {
  const [layoutProps, setLayoutProps] = useState<LayoutProps>({
    showFooter: true,
    showHeader: true,
    containerized: true,
    mainClassName: 'px-4 mt-6',
    fullHeight: false,
  });

  return (
    <Provider value={{ layoutProps, setLayoutProps }}>{children}</Provider>
  );
};
