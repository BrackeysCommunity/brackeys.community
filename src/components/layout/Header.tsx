import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
} from '@headlessui/react';
import { Link, useRouterState } from '@tanstack/react-router';
import { ChevronDown, Menu as MenuIcon, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { HeaderUser } from '../../integrations/clerk';
import { cn } from '../../lib/utils';
import { getRouteDisplayName } from '../../router';
import { useAuthHelpers, useUser } from '../../store';

type NavigationItem = {
  name: string;
  href: string;
  requiresAuth?: boolean;
  isDynamic?: boolean;
};

const navigation: NavigationItem[] = [
  { name: 'Home', href: '/' },
  { name: 'Resources', href: '/resources' },
  { name: 'Collab', href: '/collaboration-hub' },
];

// Mapping of nav item names to their active/collapsed display titles
const activeNavTitles: Record<string, string> = {
  Home: 'Community',
  Resources: 'Resources',
  Collab: 'Collab',
};

export const Header = () => {
  const user = useUser();
  const { signOut } = useAuthHelpers();
  const { location } = useRouterState();
  const [navExpanded, setNavExpanded] = useState(false);
  const [showBackground, setShowBackground] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const navItemRefs = useRef<(HTMLElement | null)[]>([]);
  const navContainerRef = useRef<HTMLDivElement | null>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const unhoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [activeTabStyle, setActiveTabStyle] = useState<{
    left: number;
    width: number;
  } | null>(null);

  // Build navigation with current page if not in default list
  const buildNavigation = (): NavigationItem[] => {
    const filtered = navigation.filter((item) => !item.requiresAuth || user);

    // Check if current path is in the navigation
    const currentPathInNav = filtered.some(
      (item) => location.pathname === item.href,
    );

    // If current path is not in navigation, add it as a dynamic item
    if (!currentPathInNav && location.pathname !== '/') {
      return [
        ...filtered,
        {
          name: getRouteDisplayName(location.pathname),
          href: location.pathname,
          isDynamic: true,
        },
      ];
    }

    return filtered;
  };

  const filteredNavigation = buildNavigation();
  const currentItemIndex = filteredNavigation.findIndex(
    (item) => location.pathname === item.href,
  );

  // Handle hover start: throttled expansion
  const handleHoverStart = () => {
    // Cancel any pending collapse
    if (unhoverTimeoutRef.current) {
      clearTimeout(unhoverTimeoutRef.current);
      unhoverTimeoutRef.current = null;
    }
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }

    // Throttle the opening - wait 100ms before expanding
    hoverTimeoutRef.current = setTimeout(() => {
      // First, expand the nav (this will cause chevron to fade out)
      setNavExpanded(true);
      // Wait for chevron to fade out (150ms) + nav items to expand (200ms) before showing background
      setTimeout(() => {
        const activeElement = navItemRefs.current[currentItemIndex];
        const container = navContainerRef.current;

        if (activeElement && container && currentItemIndex >= 0) {
          const containerRect = container.getBoundingClientRect();
          const elementRect = activeElement.getBoundingClientRect();

          setActiveTabStyle({
            left: elementRect.left - containerRect.left,
            width: elementRect.width,
          });
          setShowBackground(true);
        }
      }, 250); // Wait for chevron fade (150ms) + nav expand (200ms)
    }, 100); // Throttle delay
  };

  // Handle hover end: throttled collapse
  const handleHoverEnd = () => {
    // Don't collapse if user menu is open
    if (userMenuOpen) return;

    // Cancel any pending expansion
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    if (unhoverTimeoutRef.current) {
      clearTimeout(unhoverTimeoutRef.current);
      unhoverTimeoutRef.current = null;
    }

    // Throttle the closing - wait 200ms before collapsing
    unhoverTimeoutRef.current = setTimeout(() => {
      setShowBackground(false);
      // After background fades out, collapse the nav
      setTimeout(() => {
        setNavExpanded(false);
      }, 150); // Wait for background to fade out
    }, 500); // Throttle delay
  };

  // Update active tab position when route changes (while hovering)
  useEffect(() => {
    if (
      showBackground &&
      currentItemIndex >= 0 &&
      navItemRefs.current[currentItemIndex]
    ) {
      const activeElement = navItemRefs.current[currentItemIndex];
      const container = navContainerRef.current;

      if (activeElement && container) {
        const containerRect = container.getBoundingClientRect();
        const elementRect = activeElement.getBoundingClientRect();

        setActiveTabStyle({
          left: elementRect.left - containerRect.left,
          width: elementRect.width,
        });
      }
    }
  }, [currentItemIndex, showBackground]);

  // Handle user menu state changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: we don't want to re-render the effect on every render
  useEffect(() => {
    // When user menu closes, trigger collapse if not hovering
    if (!userMenuOpen && navExpanded) {
      handleHoverEnd();
    }
  }, [userMenuOpen, navExpanded]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
      if (unhoverTimeoutRef.current) {
        clearTimeout(unhoverTimeoutRef.current);
      }
    };
  }, []);

  const containerClasses =
    'relative p-px rounded-full shadow-md bg-gradient-to-br from-gray-600/60 via-gray-700/40 via-50% to-gray-600/60 pointer-events-auto';

  const containerInnerClasses =
    'relative backdrop-blur-xs rounded-full px-3 sm:px-4 h-13 flex items-center isolate before:absolute before:inset-0 before:bg-gray-900/20 before:rounded-full before:shadow-[inset_0_0_20px_rgba(0,0,0,0.5)] before:-z-10';

  return (
    <Disclosure
      as="nav"
      className="sticky top-0 z-50 container mx-auto flex justify-center p-4 transition-all duration-200 pointer-events-none"
    >
      {({ open }) => (
        <>
          <div className="w-full flex justify-between items-center gap-4">
            {/* Left Container: Branding + Navigation */}
            <div className={containerClasses}>
              <motion.div
                className={cn(containerInnerClasses, navExpanded && 'gap-4')}
                onHoverStart={handleHoverStart}
                onHoverEnd={handleHoverEnd}
              >
                {/* Branding */}
                <Link to="/" className="flex items-center gap-2 shrink-0">
                  <motion.div
                    className="h-8 w-8 mask-[url(/svg/brackeys-logo.svg)]"
                    initial={{
                      backgroundImage:
                        'linear-gradient(to bottom, var(--color-brackeys-yellow), var(--color-brackeys-fuscia), var(--color-brackeys-purple), var(--color-brackeys-fuscia), var(--color-brackeys-yellow))',
                      backgroundPosition: '0 0%',
                      backgroundSize: '100% 500%',
                    }}
                    animate={{
                      backgroundPosition: [
                        '0 0%',
                        '0 0%',
                        '0 100%',
                        '0 100%',
                        '0 0%',
                      ],
                    }}
                    transition={{
                      duration: 6,
                      times: [0, 0.2, 0.4, 0.6, 0.8, 1],
                      repeat: Infinity,
                      ease: 'linear',
                    }}
                  />
                  <span className="font-bold text-white text-lg">Brackeys</span>
                </Link>

                {/* Expandable Navigation (Desktop) */}
                <motion.div
                  ref={navContainerRef}
                  className={cn(
                    'hidden sm:flex items-center relative rounded-lg py-1',
                    navExpanded ? 'space-x-2' : 'mr-2',
                  )}
                  initial={false}
                >
                  {/* Bouncing Chevron Indicator - Right side, absolutely positioned */}
                  <AnimatePresence>
                    {!navExpanded && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 0.5 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="absolute -right-4 pointer-events-none"
                      >
                        <ChevronDown
                          size={16}
                          className="text-gray-300 -rotate-90 animate-bounce"
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Single Sliding Background - Animates position and size */}
                  <AnimatePresence>
                    {showBackground && activeTabStyle && (
                      <motion.div
                        className="absolute bg-brackeys-purple-800 rounded-full h-[calc(100%-0.5rem)] top-1"
                        initial={{ opacity: 0 }}
                        animate={{
                          opacity: 1,
                          left: activeTabStyle.left,
                          width: activeTabStyle.width,
                        }}
                        exit={{ opacity: 0 }}
                        transition={{
                          opacity: { duration: 0.15 },
                          left: {
                            type: 'spring',
                            stiffness: 500,
                            damping: 30,
                          },
                          width: {
                            type: 'spring',
                            stiffness: 500,
                            damping: 30,
                          },
                        }}
                      />
                    )}
                  </AnimatePresence>

                  {/* Navigation Items */}
                  {filteredNavigation.map((item, index) => {
                    const isActive = location.pathname === item.href;
                    const isActiveOrExpanded = isActive || navExpanded;
                    // Use active title when collapsed and active, otherwise use regular name
                    const displayName =
                      !navExpanded && isActive && activeNavTitles[item.name]
                        ? activeNavTitles[item.name]
                        : item.name;

                    return (
                      <motion.div
                        key={item.name}
                        initial={false}
                        animate={{
                          opacity: isActiveOrExpanded ? 1 : 0,
                          width: isActiveOrExpanded ? 'auto' : 0,
                        }}
                        transition={{
                          duration: 0.2,
                          ease: 'easeOut',
                        }}
                        style={{ overflow: 'hidden', position: 'relative' }}
                      >
                        <Link
                          to={item.href}
                          ref={(el) => {
                            navItemRefs.current[index] = el;
                          }}
                          className={cn(
                            'relative block py-2 rounded-full whitespace-nowrap transition-all duration-200',
                            // Padding - consistent px-3 when expanded, pr-3 when collapsed
                            navExpanded ? 'px-3' : 'pr-3',
                            // When collapsed (not expanded), make active item larger and bolder with gradient
                            !navExpanded &&
                              isActive &&
                              'text-lg font-bold bg-gradient-to-r from-brackeys-yellow via-brackeys-fuscia to-brackeys-purple bg-clip-text text-transparent',
                            // When expanded, all items are same size
                            navExpanded && 'text-sm font-medium',
                            // Color styling - only apply when not the special collapsed active case
                            navExpanded && isActive && 'text-gray-200',
                            !isActive &&
                              'text-gray-300 hover:text-white hover:bg-gray-700/50',
                          )}
                          style={{ zIndex: 1 }}
                        >
                          {displayName}
                        </Link>
                      </motion.div>
                    );
                  })}
                </motion.div>

                {/* Mobile Menu Button */}
                <div className="-mr-2 flex items-center sm:hidden">
                  <DisclosureButton className="relative inline-flex items-center justify-center rounded-md p-2 text-gray-300 hover:bg-gray-800 focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-brackeys-purple-500">
                    <span className="sr-only">Open main menu</span>
                    {open ? (
                      <X className="block h-6 w-6" aria-hidden="true" />
                    ) : (
                      <MenuIcon className="block h-6 w-6" aria-hidden="true" />
                    )}
                  </DisclosureButton>
                </div>
              </motion.div>
            </div>

            {/* Right Container: User Profile Only */}
            <div className={cn(containerClasses, 'hidden sm:block')}>
              <div className={cn(containerInnerClasses, '!px-3')}>
                <HeaderUser
                  onMenuOpen={() => setUserMenuOpen(true)}
                  onMenuClose={() => {
                    // Delay closing to allow for menu interaction
                    setTimeout(() => setUserMenuOpen(false), 300);
                  }}
                />
              </div>
            </div>
          </div>

          {/* Mobile Menu */}
          <DisclosurePanel className="absolute top-full left-0 right-0 mt-2 mx-auto max-w-7xl w-full bg-gray-900/80 backdrop-blur-md rounded-lg shadow-md sm:hidden">
            <div className="space-y-1 px-2 pb-3 pt-2">
              {navigation.map((item) => (
                <DisclosureButton
                  key={item.name}
                  as={Link}
                  to={item.href}
                  className={cn(
                    'block px-3 py-2 rounded-md text-base font-medium',
                    location.pathname === item.href
                      ? 'bg-brackeys-purple-900/30 text-brackeys-purple-300'
                      : 'text-gray-300 hover:bg-gray-800',
                  )}
                >
                  {item.name}
                </DisclosureButton>
              ))}
              {!user && (
                <DisclosureButton
                  as={Link}
                  to="/login"
                  className="block w-full text-left px-3 py-2 rounded-md text-base font-medium text-brackeys-purple-400 hover:bg-gray-800"
                >
                  Sign in
                </DisclosureButton>
              )}
              {user && (
                <DisclosureButton
                  as="button"
                  onClick={signOut}
                  className="block w-full text-left px-3 py-2 rounded-md text-base font-medium text-red-500 hover:bg-gray-800"
                >
                  Sign out
                </DisclosureButton>
              )}
            </div>
            {user && (
              <div className="border-t border-gray-700 pb-3 pt-4">
                <div className="flex items-center px-4">
                  {user.imageUrl ? (
                    <img
                      className="h-8 w-8 rounded-full"
                      src={user.imageUrl}
                      alt={user.username || 'User'}
                    />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-brackeys-purple-800 flex items-center justify-center">
                      <span className="text-brackeys-purple-300 font-medium">
                        {user.username?.charAt(0) || 'U'}
                      </span>
                    </div>
                  )}
                  <div className="ml-3">
                    <div className="text-base font-medium text-white">
                      {user.username || 'User'}
                    </div>
                    <div className="text-sm font-medium text-gray-400">
                      {user.primaryEmailAddress}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </DisclosurePanel>
        </>
      )}
    </Disclosure>
  );
};
