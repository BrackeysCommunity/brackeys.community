import type { Meta, StoryObj } from '@storybook/react';
import { LinkButton } from '../components/ui/LinkButton';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';

// Create a simple router for testing
const rootRoute = createRootRoute();
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => null,
});

const aboutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/about',
  component: () => null,
});

const routeTree = rootRoute.addChildren([indexRoute, aboutRoute]);

const meta = {
  title: 'UI/LinkButton',
  component: LinkButton,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  decorators: [
    (Story) => {
      const router = createRouter({
        routeTree,
        history: createMemoryHistory(),
      });

      return (
        <RouterProvider router={router}>
          <Story />
        </RouterProvider>
      );
    },
  ],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
    to: {
      control: 'text',
    },
  },
} satisfies Meta<typeof LinkButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {
    variant: 'primary',
    size: 'md',
    to: '/',
    children: 'Primary Link Button',
  },
};

export const Secondary: Story = {
  args: {
    variant: 'secondary',
    size: 'md',
    to: '/',
    children: 'Secondary Link Button',
  },
};

export const Ghost: Story = {
  args: {
    variant: 'ghost',
    size: 'md',
    to: '/',
    children: 'Ghost Link Button',
  },
};

export const Small: Story = {
  args: {
    variant: 'primary',
    size: 'sm',
    to: '/',
    children: 'Small Link',
  },
};

export const Large: Story = {
  args: {
    variant: 'primary',
    size: 'lg',
    to: '/',
    children: 'Large Link Button',
  },
};

export const AllVariantsAndSizes: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3 items-center">
        <LinkButton to="/" variant="primary" size="sm">Small Primary</LinkButton>
        <LinkButton to="/" variant="primary" size="md">Medium Primary</LinkButton>
        <LinkButton to="/" variant="primary" size="lg">Large Primary</LinkButton>
      </div>
      <div className="flex gap-3 items-center">
        <LinkButton to="/" variant="secondary" size="sm">Small Secondary</LinkButton>
        <LinkButton to="/" variant="secondary" size="md">Medium Secondary</LinkButton>
        <LinkButton to="/" variant="secondary" size="lg">Large Secondary</LinkButton>
      </div>
      <div className="flex gap-3 items-center">
        <LinkButton to="/" variant="ghost" size="sm">Small Ghost</LinkButton>
        <LinkButton to="/" variant="ghost" size="md">Medium Ghost</LinkButton>
        <LinkButton to="/" variant="ghost" size="lg">Large Ghost</LinkButton>
      </div>
    </div>
  ),
};

export const NavigationExample: Story = {
  render: () => (
    <nav className="flex gap-4">
      <LinkButton to="/" variant="primary">
        Home
      </LinkButton>
      <LinkButton to="/about" variant="secondary">
        About
      </LinkButton>
      <LinkButton to="/contact" variant="ghost">
        Contact
      </LinkButton>
    </nav>
  ),
};
