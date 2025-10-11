import { motion } from 'motion/react';
import { Outlet } from '@tanstack/react-router';
import { Header } from './Header';
import { Footer } from './Footer';
import { cn } from '../../lib/utils';
import { useLayout } from '../../context/layoutContext';

export const MainLayout = () => {
  const { layoutProps } = useLayout();

  return (
    <div className="flex flex-col min-h-screen bg-gray-900">
      {layoutProps.showHeader && (
        <>
          <div className="fixed z-20 top-0 left-0 right-0 h-24 bg-gradient-to-b from-gray-900 via-gray-900/95 to-transparent pointer-events-none" />
          <Header />
        </>
      )}
      <motion.main
        className={cn(
          'flex-1 transition-all duration-200',
          layoutProps.mainClassName,
          layoutProps.containerized && 'container mx-auto',
          layoutProps.fullHeight && 'h-full',
        )}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Outlet />
      </motion.main>
      {layoutProps.showFooter && <Footer />}
    </div>
  );
};
