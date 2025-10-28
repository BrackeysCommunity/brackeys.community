import type { Meta, StoryObj } from '@storybook/react-vite';
import { AlertTriangle, Trash2, User } from 'lucide-react';
import type React from 'react';
import { useId, useState } from 'react';
import { Button } from './Button';
import { Input } from './Input';
import { Modal } from './Modal';

const meta = {
  title: 'UI/Modal',
  component: Modal,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    maxWidth: {
      control: 'select',
      options: ['sm', 'md', 'lg', 'xl', '2xl'],
    },
    showCloseButton: {
      control: 'boolean',
    },
    allowEscape: {
      control: 'boolean',
    },
    closeOnBackdropClick: {
      control: 'boolean',
    },
  },
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

// Basic Modal
export const Basic: Story = {
  args: {
    isOpen: false,
    children: <div />,
  },
  render: () => {
    const [isOpen, setIsOpen] = useState(false);

    return (
      <>
        <Button variant="primary" onClick={() => setIsOpen(true)}>
          Open Basic Modal
        </Button>

        <Modal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          title="Basic Modal"
        >
          <div className="py-4">
            <p className="text-gray-300">
              This is a basic modal with a title and close button. You can put
              any content here.
            </p>
          </div>
        </Modal>
      </>
    );
  },
};

// Modal with Actions
export const WithActions: Story = {
  args: {
    isOpen: false,
    children: <div />,
  },
  render: () => {
    const [isOpen, setIsOpen] = useState(false);

    return (
      <>
        <Button variant="primary" onClick={() => setIsOpen(true)}>
          Open Modal with Actions
        </Button>

        <Modal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          title="Confirm Action"
          actions={
            <div className="flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => setIsOpen(false)}>
                Delete
              </Button>
            </div>
          }
        >
          <div className="py-4">
            <p className="text-gray-300">
              Are you sure you want to delete this item? This action cannot be
              undone.
            </p>
          </div>
        </Modal>
      </>
    );
  },
};

// Modal with Back Button
export const WithBackButton: Story = {
  args: {
    isOpen: false,
    children: <div />,
  },
  render: () => {
    const [isOpen, setIsOpen] = useState(false);

    return (
      <>
        <Button variant="primary" onClick={() => setIsOpen(true)}>
          Open Modal with Back Button
        </Button>

        <Modal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          onBack={() => setIsOpen(false)}
          title="Settings"
        >
          <div className="py-4">
            <p className="text-gray-300 mb-4">
              This modal has a back button instead of a close button.
            </p>
            <p className="text-gray-400 text-sm">
              Use this pattern when the modal is part of a multi-step flow.
            </p>
          </div>
        </Modal>
      </>
    );
  },
};

// Different Sizes
export const Sizes: Story = {
  args: {
    isOpen: false,
    children: <div />,
  },
  render: () => {
    const [openModal, setOpenModal] = useState<string | null>(null);

    const sizes = [
      { key: 'sm', label: 'Small', maxWidth: 'sm' as const },
      { key: 'md', label: 'Medium', maxWidth: 'md' as const },
      { key: 'lg', label: 'Large', maxWidth: 'lg' as const },
      { key: 'xl', label: 'Extra Large', maxWidth: 'xl' as const },
      { key: '2xl', label: '2X Large', maxWidth: '2xl' as const },
    ];

    return (
      <>
        <div className="flex flex-wrap gap-3">
          {sizes.map((size) => (
            <Button
              key={size.key}
              variant="primary"
              onClick={() => setOpenModal(size.key)}
            >
              {size.label} Modal
            </Button>
          ))}
        </div>

        {sizes.map((size) => (
          <Modal
            key={size.key}
            isOpen={openModal === size.key}
            onClose={() => setOpenModal(null)}
            title={`${size.label} Modal`}
            maxWidth={size.maxWidth}
          >
            <div className="py-4">
              <p className="text-gray-300">
                This is a {size.label.toLowerCase()} modal. The content adjusts
                to the specified maximum width.
              </p>
              <div className="mt-4 p-3 bg-gray-700 rounded text-sm text-gray-400">
                Max width: {size.maxWidth}
              </div>
            </div>
          </Modal>
        ))}
      </>
    );
  },
};

// Form Modal
export const FormModal: Story = {
  args: {
    isOpen: false,
    children: <div />,
  },
  render: () => {
    const [isOpen, setIsOpen] = useState(false);
    const [formData, setFormData] = useState({
      name: '',
      email: '',
      role: '',
    });

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      alert(`Submitted: ${JSON.stringify(formData, null, 2)}`);
      setIsOpen(false);
    };

    const handleChange = (field: string) => (value: string) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
    };

    return (
      <>
        <Button variant="primary" onClick={() => setIsOpen(true)}>
          <User className="w-4 h-4 mr-2" />
          Add User
        </Button>

        <Modal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          title="Add New User"
          maxWidth="md"
          actions={
            <div className="flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit">
                Add User
              </Button>
            </div>
          }
        >
          <form id={useId()} onSubmit={handleSubmit} className="py-4 space-y-4">
            <Input
              type="text"
              placeholder="Full Name"
              value={formData.name}
              onChange={handleChange('name')}
              prefixIcon={User}
            />
            <Input
              type="email"
              placeholder="Email Address"
              value={formData.email}
              onChange={handleChange('email')}
            />
            <Input
              type="text"
              placeholder="Role"
              value={formData.role}
              onChange={handleChange('role')}
            />
          </form>
        </Modal>
      </>
    );
  },
};

// Scrollable Content
export const ScrollableContent: Story = {
  args: {
    isOpen: false,
    children: <div />,
  },
  render: () => {
    const [isOpen, setIsOpen] = useState(false);

    const longContent = Array.from({ length: 50 }, (_, i) => (
      <p key={i.toString()} className="text-gray-300 mb-3">
        This is paragraph {i + 1}. Lorem ipsum dolor sit amet, consectetur
        adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore
        magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco
        laboris.
      </p>
    ));

    return (
      <>
        <Button variant="primary" onClick={() => setIsOpen(true)}>
          Open Scrollable Modal
        </Button>

        <Modal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          title="Long Content Modal"
          maxWidth="lg"
          actions={
            <Button variant="primary" onClick={() => setIsOpen(false)}>
              Got it
            </Button>
          }
        >
          <div className="py-4">
            <p className="text-gray-300 mb-6">
              This modal contains a lot of content that requires scrolling. The
              header and actions remain sticky while the content scrolls.
            </p>
            {longContent}
          </div>
        </Modal>
      </>
    );
  },
};

// Danger Modal
export const DangerModal: Story = {
  args: {
    isOpen: false,
    children: <div />,
  },
  render: () => {
    const [isOpen, setIsOpen] = useState(false);

    return (
      <>
        <Button variant="danger" onClick={() => setIsOpen(true)}>
          <Trash2 className="w-4 h-4 mr-2" />
          Delete Account
        </Button>

        <Modal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          title="Delete Account"
          maxWidth="md"
          actions={
            <div className="flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => setIsOpen(false)}>
                Delete Forever
              </Button>
            </div>
          }
        >
          <div className="py-4">
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="text-white font-medium mb-2">
                  This action cannot be undone
                </h4>
                <p className="text-gray-300">
                  Deleting your account will permanently remove all your data,
                  including projects, settings, and personal information. Make
                  sure you have downloaded any important data before proceeding.
                </p>
              </div>
            </div>

            <div className="bg-red-900/20 border border-red-800 rounded-lg p-3">
              <p className="text-red-200 text-sm">
                <strong>Warning:</strong> This will delete your account
                immediately. There is no way to recover your data after this
                action.
              </p>
            </div>
          </div>
        </Modal>
      </>
    );
  },
};

// No Close Button
export const NoCloseButton: Story = {
  args: {
    isOpen: false,
    children: <div />,
  },
  render: () => {
    const [isOpen, setIsOpen] = useState(false);

    return (
      <>
        <Button variant="primary" onClick={() => setIsOpen(true)}>
          Open Modal (No Close Button)
        </Button>

        <Modal
          isOpen={isOpen}
          onClose={() => setIsOpen(false)}
          title="Important Notice"
          showCloseButton={false}
          actions={
            <Button variant="primary" onClick={() => setIsOpen(false)}>
              I Understand
            </Button>
          }
        >
          <div className="py-4">
            <p className="text-gray-300">
              This modal doesn't have a close button in the header. You must use
              the action button to close it.
            </p>
          </div>
        </Modal>
      </>
    );
  },
};
