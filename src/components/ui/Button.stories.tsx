import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  Play,
  Settings,
  Download,
  Heart,
  Star,
  Trash,
  CheckCircle,
  AlertTriangle,
  Zap,
  Globe,
  Shield,
  Database,
  Code,
  Paintbrush,
} from 'lucide-react';
import { Button } from './Button';

const meta = {
  title: 'UI/Button',
  component: Button,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: [
        'primary',
        'secondary',
        'success',
        'danger',
        'ghost',
        'card',
        'checkbox',
        'checkbox-card',
      ],
    },
    size: {
      control: 'select',
      options: ['icon', 'sm', 'md', 'lg', 'card'],
    },
    layout: {
      control: 'select',
      options: ['default', 'vertical', 'horizontal'],
    },
    cardColor: {
      control: 'select',
      options: ['green', 'yellow', 'purple', 'blue'],
    },
    disabled: {
      control: 'boolean',
    },
    loading: {
      control: 'boolean',
    },
    fullWidth: {
      control: 'boolean',
    },
    selected: {
      control: 'boolean',
    },
    colorizeHover: {
      control: 'boolean',
    },
    showCheckmark: {
      control: 'boolean',
    },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

// Basic Button Variants
export const Primary: Story = {
  args: {
    children: 'Primary Button',
    variant: 'primary',
  },
};

export const Secondary: Story = {
  args: {
    children: 'Secondary Button',
    variant: 'secondary',
  },
};

export const Success: Story = {
  args: {
    children: 'Success Button',
    variant: 'success',
  },
};

export const Danger: Story = {
  args: {
    children: 'Danger Button',
    variant: 'danger',
  },
};

export const Ghost: Story = {
  args: {
    children: 'Ghost Button',
    variant: 'ghost',
  },
};

// Button Sizes
export const Sizes: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Button variant="primary" size="icon">
          <Play className="w-4 h-4" />
        </Button>
        <Button variant="primary" size="sm">
          Small Button
        </Button>
        <Button variant="primary" size="md">
          Medium Button
        </Button>
        <Button variant="primary" size="lg">
          Large Button
        </Button>
      </div>
    </div>
  ),
};

// Button States
export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Button variant="primary">Normal</Button>
        <Button variant="primary" loading>
          Loading
        </Button>
        <Button variant="primary" disabled>
          Disabled
        </Button>
        <Button variant="primary" disabled loading>
          Disabled Loading
        </Button>
      </div>
    </div>
  ),
};

// Full Width
export const FullWidth: Story = {
  render: () => (
    <div className="w-96">
      <Button variant="primary" fullWidth>
        Full Width Button
      </Button>
    </div>
  ),
};

// Card Variants - Now properly named!
export const CardVertical: Story = {
  args: {
    variant: 'card',
    layout: 'vertical', // Icon on top, stacked vertically
    icon: <Settings className="w-6 h-6" />,
    title: 'Settings',
    subtitle: 'Configure your preferences',
  },
};

export const CardHorizontal: Story = {
  args: {
    variant: 'card',
    layout: 'horizontal', // Icon on left, content flows horizontally
    icon: <Download className="w-6 h-6" />,
    title: 'Download',
    subtitle: 'Get the latest version',
  },
};

// Checkbox Card Variants
export const CheckboxCard: Story = {
  args: {
    variant: 'checkbox-card',
    layout: 'vertical',
    icon: <Heart className="w-6 h-6" />,
    title: 'Favorites',
    subtitle: 'Save your favorite items',
    selected: true,
    cardColor: 'green',
  },
};

export const CheckboxCardUnselected: Story = {
  args: {
    variant: 'checkbox-card',
    layout: 'vertical',
    icon: <Star className="w-6 h-6" />,
    title: 'Premium',
    subtitle: 'Unlock premium features',
    selected: false,
    cardColor: 'purple',
  },
};

// Card Colors
export const CardColors: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-4">
      <Button
        variant="checkbox-card"
        layout="vertical"
        icon={<CheckCircle className="w-6 h-6" />}
        title="Success"
        subtitle="Green theme"
        selected={true}
        cardColor="green"
      />
      <Button
        variant="checkbox-card"
        layout="vertical"
        icon={<AlertTriangle className="w-6 h-6" />}
        title="Warning"
        subtitle="Yellow theme"
        selected={true}
        cardColor="yellow"
      />
      <Button
        variant="checkbox-card"
        layout="vertical"
        icon={<Zap className="w-6 h-6" />}
        title="Primary"
        subtitle="Purple theme"
        selected={true}
        cardColor="purple"
      />
      <Button
        variant="checkbox-card"
        layout="vertical"
        icon={<Globe className="w-6 h-6" />}
        title="Info"
        subtitle="Blue theme"
        selected={true}
        cardColor="blue"
      />
    </div>
  ),
};

// Layout Comparison
export const LayoutComparison: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-white mb-4">
          Vertical Layout (Default)
        </h3>
        <p className="text-gray-400 text-sm mb-4">
          Icon on top, content stacked vertically, centered
        </p>
        <div className="grid grid-cols-3 gap-4">
          <Button
            variant="card"
            layout="vertical"
            icon={<Code className="w-6 h-6" />}
            title="Development"
            subtitle="Build amazing apps"
          />
          <Button
            variant="card"
            layout="vertical"
            icon={<Paintbrush className="w-6 h-6" />}
            title="Design"
            subtitle="Create beautiful UIs"
          />
          <Button
            variant="card"
            layout="vertical"
            icon={<Database className="w-6 h-6" />}
            title="Database"
            subtitle="Store your data"
          />
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-white mb-4">
          Horizontal Layout
        </h3>
        <p className="text-gray-400 text-sm mb-4">
          Icon on left, content flows horizontally
        </p>
        <div className="space-y-3">
          <Button
            variant="card"
            layout="horizontal"
            icon={<Settings className="w-6 h-6" />}
            title="Settings"
            subtitle="Configure your preferences"
            fullWidth
          />
          <Button
            variant="card"
            layout="horizontal"
            icon={<Shield className="w-6 h-6" />}
            title="Security"
            subtitle="Manage your security settings"
            fullWidth
          />
          <Button
            variant="card"
            layout="horizontal"
            icon={<Trash className="w-6 h-6" />}
            title="Delete Account"
            subtitle="Permanently remove your account"
            fullWidth
          />
        </div>
      </div>
    </div>
  ),
};

// Colorize Hover Effect
export const ColorizeHover: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-4">
      <Button
        variant="card"
        layout="vertical"
        icon={<Shield className="w-6 h-6" />}
        title="Security"
        subtitle="Hover to see color effect"
        colorizeHover={true}
        cardColor="green"
      />
      <Button
        variant="card"
        layout="vertical"
        icon={<Database className="w-6 h-6" />}
        title="Database"
        subtitle="No color on hover"
        colorizeHover={false}
      />
    </div>
  ),
};

// Comprehensive Example
export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-col gap-8 max-w-4xl">
      {/* Standard Buttons */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-4">
          Standard Buttons
        </h3>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="success">Success</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="ghost">Ghost</Button>
        </div>
      </div>

      {/* Button States */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-4">Button States</h3>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary">Normal</Button>
          <Button variant="primary" loading>
            Loading
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
      </div>

      {/* Card Buttons */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-4">
          Card Buttons (Vertical Layout)
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <Button
            variant="card"
            layout="vertical"
            icon={<Code className="w-6 h-6" />}
            title="Development"
            subtitle="Build amazing apps"
          />
          <Button
            variant="card"
            layout="vertical"
            icon={<Paintbrush className="w-6 h-6" />}
            title="Design"
            subtitle="Create beautiful UIs"
          />
          <Button
            variant="card"
            layout="vertical"
            icon={<Trash className="w-6 h-6" />}
            title="Cleanup"
            subtitle="Remove unused files"
          />
        </div>
      </div>

      {/* Checkbox Cards */}
      <div>
        <h3 className="text-lg font-semibold text-white mb-4">
          Checkbox Cards
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <Button
            variant="checkbox-card"
            layout="vertical"
            icon={<CheckCircle className="w-6 h-6" />}
            title="Option A"
            subtitle="This option is selected"
            selected={true}
            cardColor="green"
          />
          <Button
            variant="checkbox-card"
            layout="vertical"
            icon={<Star className="w-6 h-6" />}
            title="Option B"
            subtitle="This option is not selected"
            selected={false}
            cardColor="purple"
          />
        </div>
      </div>
    </div>
  ),
};

// Interactive Examples
export const Interactive: Story = {
  args: {
    variant: 'primary',
    children: 'Click me!',
    onClick: () => alert('Button clicked!'),
  },
};

export const InteractiveCard: Story = {
  args: {
    variant: 'checkbox-card',
    layout: 'vertical',
    icon: <Heart className="w-6 h-6" />,
    title: 'Interactive Card',
    subtitle: 'Click to toggle selection',
    selected: false,
    cardColor: 'purple',
    onClick: () => alert('Card clicked!'),
  },
};
