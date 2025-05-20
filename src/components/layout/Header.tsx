import { Link, useRouterState } from '@tanstack/react-router';
import { motion } from 'motion/react';
import { Disclosure, DisclosureButton, DisclosurePanel, Menu, MenuButton, MenuItem, MenuItems, Transition } from '@headlessui/react';
import { Menu as MenuIcon, X, User, LogOut } from 'lucide-react';
import { useAuth } from '../../context/useAuth';
import { cn } from '../../lib/utils';

type NavigationItem = {
  name: string;
  href: string;
  requiresAuth?: boolean;
};

const navigation: NavigationItem[] = [
  { name: 'Home', href: '/' },
  { name: 'Dashboard', href: '/dashboard', requiresAuth: true },
  { name: 'Games', href: '/games' },
  { name: 'Tools', href: '/tools' },
  { name: 'API', href: '/api' },
];

export const Header = () => {
  const { state: { user }, signOut } = useAuth();
  const { location } = useRouterState();

  return (
    <Disclosure as="nav" className="sticky top-0 z-50 container mx-auto flex justify-center p-4 transition-all duration-200">
      {({ open }) => (
        <>
          <div className="w-full bg-gray-800/60 border border-gray-700 backdrop-blur-md rounded-lg shadow-md">
            <div className="px-4 sm:px-6 lg:px-8">
              <div className="flex h-16 justify-between">
                <div className="flex">
                  <div className="flex shrink-0 items-center">
                    <Link to="/" className="flex items-center gap-2">
                      <motion.div
                        className="h-8 w-8 mask-[url(/svg/brackeys-logo.svg)]"
                        initial={{
                          backgroundImage: "linear-gradient(to bottom, var(--color-brackeys-yellow), var(--color-brackeys-fuscia), var(--color-brackeys-purple), var(--color-brackeys-fuscia), var(--color-brackeys-yellow))",
                          backgroundPosition: "0 0%",
                          backgroundSize: "100% 500%"
                        }}
                        animate={{
                          backgroundPosition: ["0 0%", "0 0%", "0 100%", "0 100%", "0 0%"]
                        }}
                        transition={{
                          duration: 6,
                          times: [0, .2, .4, .6, .8, 1],
                          repeat: Infinity,
                          ease: "linear"
                        }}
                      />
                      <span className="font-bold text-white text-lg">
                        Brackeys<span className="bg-gradient-to-r from-brackeys-yellow via-brackeys-fuscia to-brackeys-purple bg-clip-text text-transparent">Community</span>
                      </span>
                    </Link>
                  </div>
                  <div className="hidden sm:ml-6 sm:flex sm:items-center sm:space-x-4">
                    {navigation.filter((item) => !item.requiresAuth || user).map((item) => (
                      <Link
                        key={item.name}
                        to={item.href}
                        className={cn(
                          'px-3 py-2 rounded-md text-sm font-medium transition-colors',
                          location.pathname === item.href
                            ? 'bg-brackeys-purple-800 text-brackeys-purple-200'
                            : 'text-gray-300 hover:bg-gray-800'
                        )}
                      >
                        {item.name}
                      </Link>
                    ))}
                  </div>
                </div>

                <div className="flex items-center">
                  {user ? (
                    <div className="hidden sm:ml-6 sm:flex sm:items-center">
                      <Menu as="div" className="relative ml-3">
                        <div>
                          <MenuButton className="flex rounded-full bg-gray-800 text-sm focus:outline-hidden focus:ring-2 focus:ring-brackeys-purple-500 focus:ring-offset-2 focus:ring-offset-background">
                            <span className="sr-only">Open user menu</span>
                            {user.avatar_url ? (
                              <img
                                className="h-8 w-8 rounded-full"
                                src={user.avatar_url}
                                alt={user.username || 'User'}
                              />
                            ) : (
                              <div className="h-8 w-8 rounded-full bg-brackeys-purple-800 flex items-center justify-center">
                                <span className="text-brackeys-purple-300 font-medium">
                                  {user.username?.charAt(0) || 'U'}
                                </span>
                              </div>
                            )}
                          </MenuButton>
                        </div>
                        <Transition
                          enter="transition ease-out duration-100"
                          enterFrom="transform opacity-0 scale-95"
                          enterTo="transform opacity-100 scale-100"
                          leave="transition ease-in duration-75"
                          leaveFrom="transform opacity-100 scale-100"
                          leaveTo="transform opacity-0 scale-95"
                        >
                          <MenuItems className="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-gray-800 py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-hidden">
                            <MenuItem>
                              {({ focus }) => (
                                <Link
                                  to="/profile"
                                  className={cn(
                                    'flex items-center gap-2 px-4 py-2 text-sm',
                                    focus
                                      ? 'bg-gray-700 text-white'
                                      : 'text-gray-300'
                                  )}
                                >
                                  <User size={16} />
                                  Profile
                                </Link>
                              )}
                            </MenuItem>
                            <MenuItem>
                              {({ focus }) => (
                                <button
                                  onClick={signOut}
                                  className={cn(
                                    'flex w-full items-center gap-2 px-4 py-2 text-sm',
                                    focus
                                      ? 'bg-gray-700 text-white'
                                      : 'text-gray-300'
                                  )}
                                >
                                  <LogOut size={16} />
                                  Sign out
                                </button>
                              )}
                            </MenuItem>
                          </MenuItems>
                        </Transition>
                      </Menu>
                    </div>
                  ) : (
                    <Link
                      to="/login"
                      className="hidden sm:block rounded-md px-3 py-2 text-sm font-medium text-brackeys-purple-400 hover:text-brackeys-purple-300"
                    >
                      Sign in
                    </Link>
                  )}
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
                </div>
              </div>
            </div>
          </div>

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
                      : 'text-gray-300 hover:bg-gray-800'
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
                  {user.avatar_url ? (
                    <img
                      className="h-8 w-8 rounded-full"
                      src={user.avatar_url}
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
                      {user.email}
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