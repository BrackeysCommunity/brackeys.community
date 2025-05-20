import { motion } from 'motion/react';
import { Outlet } from '@tanstack/react-router';
import { Header } from './Header';
import { Footer } from './Footer';
import { useRouterState } from '@tanstack/react-router';
import { cn } from '../../lib/utils';

export const MainLayout = () => {
  const { location: { pathname } } = useRouterState();

  return (
    <div className="flex flex-col min-h-screen bg-gray-900">
      <Header />
      <motion.main
        className={cn("flex-1 px-4 pt-8", pathname !== "/api" && "container mx-auto pb-8 transition-all duration-200")}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Outlet />
      </motion.main>
      {pathname !== "/api" && <Footer />}
    </div>
  );
};