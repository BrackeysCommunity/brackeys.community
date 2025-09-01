import type { Meta, StoryObj } from '@storybook/react-vite';
import { Alert } from '../components/ui/Alert';

const meta = {
  title: 'UI/Alert',
  component: Alert,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['info', 'success', 'warning', 'error'],
    },
    title: {
      control: 'text',
    },
    description: {
      control: 'text',
    },
  },
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Info: Story = {
  args: {
    variant: 'info',
    title: 'Information',
    description: 'This is an informational alert message.',
  },
};

export const Success: Story = {
  args: {
    variant: 'success',
    title: 'Success!',
    description: 'Your action has been completed successfully.',
  },
};

export const Warning: Story = {
  args: {
    variant: 'warning',
    title: 'Warning',
    description: 'Please review this important information.',
  },
};

export const Error: Story = {
  args: {
    variant: 'error',
    title: 'Error',
    description: 'An error occurred while processing your request.',
  },
};

export const TitleOnly: Story = {
  args: {
    variant: 'info',
    title: 'This alert only has a title',
  },
};

export const DescriptionOnly: Story = {
  args: {
    variant: 'info',
    description: 'This alert only has a description without a title.',
  },
};

export const WithChildren: Story = {
  args: {
    variant: 'info',
    title: 'Custom Content',
    children: (
      <div className="space-y-2">
        <p>This alert contains custom child elements.</p>
        <button className="text-blue-400 underline hover:text-blue-300">
          Learn more
        </button>
      </div>
    ),
  },
};

export const LongContent: Story = {
  args: {
    variant: 'warning',
    title: 'Important Notice',
    description: 'This is a very long description that demonstrates how the alert component handles extended content. The alert should properly wrap text and maintain proper spacing and readability even with multiple lines of content.',
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className="space-y-4 w-full max-w-2xl">
      <Alert
        variant="info"
        title="Information"
        description="This is an informational message."
      />
      <Alert
        variant="success"
        title="Success"
        description="Your operation completed successfully."
      />
      <Alert
        variant="warning"
        title="Warning"
        description="Please pay attention to this warning."
      />
      <Alert
        variant="error"
        title="Error"
        description="An error has occurred."
      />
    </div>
  ),
};
