import { ClerkProvider } from '@clerk/tanstack-react-start';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { useEffect } from 'react';
import { UserStoreProvider, userStoreActions } from '../../store';
import { LoginButton } from './LoginButton';

// Mock Clerk publishable key for Storybook
const MOCK_CLERK_KEY = 'pk_test_mock_key_for_storybook';

// Wrapper component that ensures store is initialized
function StoryWrapper({ Story }: { Story: React.ComponentType }) {
  useEffect(() => {
    // Initialize the store with a non-loading state for Storybook
    userStoreActions.setLoading(false);
    userStoreActions.setUser(null); // No user signed in by default
  }, []);

  return (
    <div className="w-80">
      <Story />
    </div>
  );
}

// Decorator to provide all necessary context
const withProviders = (Story: React.ComponentType) => {
  // Create a root route
  const rootRoute = createRootRoute();

  // Create an index route that renders our story
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <StoryWrapper Story={Story} />,
  });

  const routeTree = rootRoute.addChildren([indexRoute]);

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });

  return (
    <ClerkProvider publishableKey={MOCK_CLERK_KEY}>
      <UserStoreProvider>
        <RouterProvider router={router} />
      </UserStoreProvider>
    </ClerkProvider>
  );
};

const meta = {
  title: 'Auth/LoginButton',
  component: LoginButton,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  decorators: [withProviders],
} satisfies Meta<typeof LoginButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};

export const WithCustomClass: Story = {
  args: {
    className: 'rounded-full',
  },
};

export const InContext: Story = {
  render: () => (
    <div className="bg-gray-800 p-8 rounded-lg space-y-4">
      <h2 className="text-white text-center text-xl font-semibold mb-4">
        Welcome Back!
      </h2>
      <p className="text-gray-300 text-center text-sm mb-6">
        Sign in to access your dashboard and community features
      </p>
      <LoginButton />
      <p className="text-gray-400 text-center text-xs mt-4">
        By signing in, you agree to our Terms of Service
      </p>
    </div>
  ),
};

export const MultipleOptions: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="bg-gray-800 p-6 rounded-lg">
        <h3 className="text-white text-lg font-medium mb-4">Sign in options</h3>
        <div className="space-y-3">
          <LoginButton />
          <button
            type="button"
            className="w-full px-6 py-3 text-gray-300 font-medium rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors duration-200"
          >
            Continue as Guest
          </button>
        </div>
      </div>
    </div>
  ),
};

export const LoadingState: Story = {
  render: () => {
    // This is just for demonstration - in real usage the loading state
    // is controlled by the auth context
    return (
      <div className="space-y-4">
        <p className="text-gray-400 text-sm text-center">
          Button with loading state (for demonstration)
        </p>
        <div className="opacity-70 pointer-events-none">
          <LoginButton />
        </div>
        <p className="text-gray-500 text-xs text-center italic">
          Note: Loading state is normally controlled by auth context
        </p>
      </div>
    );
  },
};
