import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import {
  User,
  Mail,
  Lock,
  Settings,
  Download,
  Heart,
  Star,
  Trash2,
  Edit3,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from './Button';
import { Input } from './Input';
import { Loading } from './Loading';
import { Modal } from './Modal';
import { Toast } from './Toast';

const meta = {
  title: 'Design System/Overview',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'A comprehensive overview of all UI components in the Brackeys design system.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const DesignSystemOverview: Story = {
  render: () => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [formData, setFormData] = useState({
      name: '',
      email: '',
      password: '',
    });
    const [selectedOption, setSelectedOption] = useState<string | null>(null);

    const handleSave = () => {
      setIsLoading(true);
      setTimeout(() => {
        setIsLoading(false);
        toast.custom(t => (
          <Toast
            id={t}
            title="Success!"
            description="Your settings have been saved successfully."
            variant="success"
          />
        ));
      }, 2000);
    };

    const handleFormSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      toast.custom(t => (
        <Toast
          id={t}
          title="Account Created"
          description="Welcome to the platform!"
          variant="success"
          action={{
            label: 'Get Started',
            onClick: () => alert('Welcome tour started!'),
          }}
        />
      ));
      setIsModalOpen(false);
      setFormData({ name: '', email: '', password: '' });
    };

    const handleOptionSelect = (option: string) => {
      setSelectedOption(option);
      toast.custom(t => (
        <Toast
          id={t}
          title="Option Selected"
          description={`You selected: ${option}`}
          variant="info"
        />
      ));
    };

    const showErrorToast = () => {
      toast.custom(t => (
        <Toast
          id={t}
          title="Connection Error"
          description="Unable to connect to the server. Please try again."
          variant="error"
        />
      ));
    };

    const showWarningToast = () => {
      toast.custom(t => (
        <Toast
          id={t}
          title="Storage Warning"
          description="You're running low on storage space."
          variant="warning"
          action={{
            label: 'Manage Storage',
            onClick: () => alert('Opening storage management...'),
          }}
        />
      ));
    };

    return (
      <div className="min-h-screen bg-gray-900 p-8">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="mb-12 text-center">
            <h1 className="text-4xl font-bold text-white mb-4">Brackeys Design System</h1>
            <p className="text-xl text-gray-300 max-w-2xl mx-auto">
              A comprehensive collection of UI components built with React, TypeScript, Tailwind
              CSS, and Headless UI. Designed for modern web applications.
            </p>
          </div>

          {/* Buttons Section */}
          <div className="mb-12">
            <h2 className="text-2xl font-semibold text-white mb-6">Buttons</h2>

            {/* Standard Buttons */}
            <div className="mb-8">
              <h3 className="text-lg font-medium text-gray-300 mb-4">Standard Variants</h3>
              <div className="flex flex-wrap gap-3">
                <Button variant="primary">Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="success">Success</Button>
                <Button variant="danger">Danger</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="primary" loading>
                  Loading
                </Button>
                <Button variant="secondary" disabled>
                  Disabled
                </Button>
              </div>
            </div>

            {/* Card Buttons */}
            <div className="mb-8">
              <h3 className="text-lg font-medium text-gray-300 mb-4">
                Card Buttons (Vertical Layout)
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <Button
                  variant="card"
                  layout="vertical"
                  icon={<Settings className="w-6 h-6" />}
                  title="Settings"
                  subtitle="Configure your preferences"
                  onClick={() => setIsModalOpen(true)}
                />
                <Button
                  variant="card"
                  layout="vertical"
                  icon={<Download className="w-6 h-6" />}
                  title="Download"
                  subtitle="Get the latest version"
                  onClick={handleSave}
                />
                <Button
                  variant="card"
                  layout="vertical"
                  icon={<Edit3 className="w-6 h-6" />}
                  title="Edit Profile"
                  subtitle="Update your information"
                />
                <Button
                  variant="card"
                  layout="vertical"
                  icon={<Trash2 className="w-6 h-6" />}
                  title="Delete"
                  subtitle="Remove permanently"
                />
              </div>
            </div>

            {/* Checkbox Cards */}
            <div>
              <h3 className="text-lg font-medium text-gray-300 mb-4">Checkbox Cards</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <Button
                  variant="checkbox-card"
                  layout="vertical"
                  icon={<Heart className="w-6 h-6" />}
                  title="Favorites"
                  subtitle="Save your favorite items"
                  selected={selectedOption === 'favorites'}
                  cardColor="green"
                  onClick={() => handleOptionSelect('favorites')}
                />
                <Button
                  variant="checkbox-card"
                  layout="vertical"
                  icon={<Star className="w-6 h-6" />}
                  title="Premium"
                  subtitle="Unlock premium features"
                  selected={selectedOption === 'premium'}
                  cardColor="purple"
                  onClick={() => handleOptionSelect('premium')}
                />
                <Button
                  variant="checkbox-card"
                  layout="vertical"
                  icon={<User className="w-6 h-6" />}
                  title="Personal"
                  subtitle="Individual account"
                  selected={selectedOption === 'personal'}
                  cardColor="blue"
                  onClick={() => handleOptionSelect('personal')}
                />
              </div>
            </div>
          </div>

          {/* Inputs Section */}
          <div className="mb-12">
            <h2 className="text-2xl font-semibold text-white mb-6">Inputs</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                <Input type="text" placeholder="Full Name" prefixIcon={User} />
                <Input type="email" placeholder="Email Address" prefixIcon={Mail} />
                <Input type="password" placeholder="Password" prefixIcon={Lock} />
              </div>
              <div className="space-y-4">
                <Input type="text" placeholder="Normal Input" />
                <Input type="text" placeholder="Disabled Input" disabled />
                <Input type="text" placeholder="Error State" error value="Invalid input" />
              </div>
            </div>
          </div>

          {/* Loading Section */}
          <div className="mb-12">
            <h2 className="text-2xl font-semibold text-white mb-6">Loading States</h2>
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
              <div className="flex items-center gap-3 text-gray-300">
                {isLoading && <Loading size="sm" />}
                <span>{isLoading ? 'Saving...' : 'Ready'}</span>
              </div>
            </div>
          </div>

          {/* Toasts Section */}
          <div className="mb-12">
            <h2 className="text-2xl font-semibold text-white mb-6">Toast Notifications</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Button
                variant="success"
                onClick={() =>
                  toast.custom(t => (
                    <Toast
                      id={t}
                      title="Success!"
                      description="Operation completed successfully."
                      variant="success"
                    />
                  ))
                }
              >
                Success Toast
              </Button>
              <Button variant="danger" onClick={showErrorToast}>
                Error Toast
              </Button>
              <Button variant="secondary" onClick={showWarningToast}>
                Warning Toast
              </Button>
              <Button
                variant="primary"
                onClick={() =>
                  toast.custom(t => (
                    <Toast
                      id={t}
                      title="Information"
                      description="Here's some useful information."
                      variant="info"
                    />
                  ))
                }
              >
                Info Toast
              </Button>
            </div>
          </div>

          {/* Action Section */}
          <div className="text-center">
            <h2 className="text-2xl font-semibold text-white mb-6">Try the Modal</h2>
            <Button variant="primary" size="lg" onClick={() => setIsModalOpen(true)}>
              <Plus className="w-5 h-5 mr-2" />
              Open Sign Up Modal
            </Button>
          </div>

          {/* Modal */}
          <Modal
            isOpen={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            title="Create Account"
            maxWidth="md"
            actions={
              <div className="flex gap-3 justify-end">
                <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit">
                  Create Account
                </Button>
              </div>
            }
          >
            <form id="signup-form" onSubmit={handleFormSubmit} className="py-4 space-y-4">
              <Input
                type="text"
                placeholder="Full Name"
                value={formData.name}
                onChange={value => setFormData(prev => ({ ...prev, name: value }))}
                prefixIcon={User}
              />
              <Input
                type="email"
                placeholder="Email Address"
                value={formData.email}
                onChange={value => setFormData(prev => ({ ...prev, email: value }))}
                prefixIcon={Mail}
              />
              <Input
                type="password"
                placeholder="Password"
                value={formData.password}
                onChange={value => setFormData(prev => ({ ...prev, password: value }))}
                prefixIcon={Lock}
              />
              <div className="pt-2">
                <p className="text-sm text-gray-400">
                  By creating an account, you agree to our Terms of Service and Privacy Policy.
                </p>
              </div>
            </form>
          </Modal>
        </div>
      </div>
    );
  },
};
