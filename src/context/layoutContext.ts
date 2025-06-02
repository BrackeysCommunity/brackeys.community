import { createContext, useContext, useEffect } from "react";

const LayoutContext = createContext<LayoutContextType | undefined>(undefined);

type LayoutContextType = {
  layoutProps: LayoutProps;
  setLayoutProps: (props: LayoutProps) => void;
}

export type LayoutProps = {
  showFooter?: boolean;
  showHeader?: boolean;
  containerized?: boolean;
  mainClassName?: string;
  fullHeight?: boolean;
}

export const Provider = LayoutContext.Provider;

export const defaultLayoutProps: LayoutProps = {
  showFooter: true,
  showHeader: true,
  containerized: true,
  mainClassName: "px-4 pt-8",
  fullHeight: false
}

export const useLayout = () => {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error('useLayout must be used within a LayoutProvider');
  }
  return context;
}

export const useLayoutProps = (props: LayoutProps) => {
  const { setLayoutProps } = useLayout();
  useEffect(() => {
    setLayoutProps(props);
    return () => { setLayoutProps(defaultLayoutProps) };
  }, [setLayoutProps, props]);
}