import type { Meta, StoryObj } from '@storybook/react-vite';
import { Loading } from '../components/ui/Loading';
import { Button } from '../components/ui/Button';
import { useState } from 'react';

const meta = {
  title: 'UI/Loading',
  component: Loading,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
  },
} satisfies Meta<typeof Loading>;

export default meta;
type Story = StoryObj<typeof meta>;

// Basic sizes
export const Small: Story = {
  args: {
    size: 'sm',
  },
};

export const Medium: Story = {
  args: {
    size: 'md',
  },
};

export const Large: Story = {
  args: {
    size: 'lg',
  },
};

// All sizes comparison
export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-8">
      <div className="text-center">
        <Loading size="sm" />
        <p className="text-sm text-gray-400 mt-2">Small</p>
      </div>
      <div className="text-center">
        <Loading size="md" />
        <p className="text-sm text-gray-400 mt-2">Medium</p>
      </div>
      <div className="text-center">
        <Loading size="lg" />
        <p className="text-sm text-gray-400 mt-2">Large</p>
      </div>
    </div>
  ),
};

// In different contexts
export const InContext: Story = {
  render: () => (
    <div className="flex flex-col gap-6 max-w-md">
      {/* In a card */}
      <div className="p-6 bg-gray-800 border border-gray-700 rounded-lg">
        <h3 className="text-lg font-semibold text-white mb-4">Loading Data...</h3>
        <Loading size="md" />
      </div>

      {/* In a button area */}
      <div className="flex gap-4">
        <Button variant="primary" loading>
          Saving...
        </Button>
        <Button variant="secondary" disabled>
          <Loading size="sm" className="mr-2" />
          Processing
        </Button>
      </div>

      {/* Inline with text */}
      <div className="flex items-center gap-3 text-gray-300">
        <Loading size="sm" />
        <span>Loading your dashboard...</span>
      </div>
    </div>
  ),
};

// Interactive example
export const Interactive: Story = {
  render: () => {
    const [isLoading, setIsLoading] = useState(false);

    const simulateLoading = () => {
      setIsLoading(true);
      setTimeout(() => setIsLoading(false), 3000);
    };

    return (
      <div className="flex flex-col items-center gap-4">
        <Button variant="primary" onClick={simulateLoading} disabled={isLoading}>
          {isLoading ? 'Loading...' : 'Start Loading'}
        </Button>

        {isLoading && (
          <div className="flex flex-col items-center gap-2">
            <Loading size="md" />
            <p className="text-sm text-gray-400">Simulating a 3 second load...</p>
          </div>
        )}
      </div>
    );
  },
};

// Different backgrounds
export const OnDifferentBackgrounds: Story = {
  render: () => (
    <div className="grid grid-cols-3 gap-4">
      {/* Dark background */}
      <div className="p-6 bg-gray-900 rounded-lg text-center">
        <Loading size="md" />
        <p className="text-xs text-gray-400 mt-2">Dark bg</p>
      </div>

      {/* Medium background */}
      <div className="p-6 bg-gray-700 rounded-lg text-center">
        <Loading size="md" />
        <p className="text-xs text-gray-400 mt-2">Medium bg</p>
      </div>

      {/* Light background */}
      <div className="p-6 bg-gray-300 rounded-lg text-center">
        <Loading size="md" />
        <p className="text-xs text-gray-600 mt-2">Light bg</p>
      </div>
    </div>
  ),
};
