import { useLocation } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { type PropsWithChildren, useRef } from 'react';
import { useLayout } from '../../context/layoutContext';
import { useGrained } from '../../hooks/useGrained';
import { cn } from '../../lib/utils';
import { Boxes } from './background-hexes';
import { Footer } from './Footer';
import { Header } from './Header';

export const MainLayout = ({ children }: PropsWithChildren) => {
  const {
    layoutProps: {
      showFooter,
      showHeader,
      containerized,
      mainClassName,
      fullHeight,
    },
  } = useLayout();

  const location = useLocation();
  const containerRef = useRef<HTMLDivElement>(null);

  // Only show heavy animations on home page
  const isHomePage = location.pathname === '/';

  useGrained(containerRef as React.RefObject<HTMLElement>, {
    animate: true,
    grainOpacity: 0.03,
  });

  return (
    <div className="flex flex-col min-h-screen bg-gray-900 relative overflow-clip">
      <div
        ref={containerRef}
        className="absolute pointer-events-none inset-0 z-10"
      />
      {/* Grid background */}
      <div
        className={cn(
          'fixed inset-0 h-[1000px] overflow-hidden flex items-start justify-center blur-[2px]',
          !isHomePage && 'blur-xl opacity-50',
        )}
      >
        <Boxes className="!left-0" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent via-60% to-gray-900 pointer-events-none" />
      </div>
      {showHeader && (
        <>
          <div className="fixed z-20 top-0 left-0 right-0 h-24 bg-gradient-to-b from-gray-900 via-gray-900 via-5% to-transparent pointer-events-none" />
          <Header />
        </>
      )}
      <motion.main
        className={cn(
          'flex-1 transition-all duration-200 pointer-events-none relative',
          mainClassName,
          containerized && 'container mx-auto',
          fullHeight && 'h-full',
          showFooter && 'mb-10',
          isHomePage && ' xl:mt-10 2xl:mt-20',
        )}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {children}
      </motion.main>
      {showFooter && (
        <div
          className={cn(
            'relative z-10',
            isHomePage && 'fixed bottom-0 inset-x-0',
          )}
        >
          <Footer />
        </div>
      )}
    </div>
  );
};
