import type { Meta, StoryObj } from '@storybook/react-vite';
import { toast } from 'sonner';
import { Button } from './Button';
import { Toast } from './Toast';

const meta = {
  title: 'UI/Toast',
  component: Toast,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['success', 'error', 'warning', 'info'],
    },
  },
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

// Static Toast Examples (for documentation)
export const Success: Story = {
  args: {
    id: 'success-toast',
    title: 'Success!',
    description: 'Your changes have been saved successfully.',
    variant: 'success',
  },
};

export const ErrorToast: Story = {
  args: {
    id: 'error-toast',
    title: 'Error',
    description: 'Something went wrong. Please try again.',
    variant: 'error',
  },
};

export const WarningToast: Story = {
  args: {
    id: 'warning-toast',
    title: 'Warning',
    description: 'This action requires your attention.',
    variant: 'warning',
  },
};

export const InfoToast: Story = {
  args: {
    id: 'info-toast',
    title: 'Information',
    description: "Here's some useful information for you.",
    variant: 'info',
  },
};

export const WithAction: Story = {
  args: {
    id: 'action-toast',
    title: 'Update Available',
    description: 'A new version is ready to install.',
    variant: 'info',
    action: {
      label: 'Update Now',
      onClick: () => alert('Update started!'),
    },
  },
};

// Interactive Examples
export const InteractiveToasts: Story = {
  render: () => {
    const showSuccessToast = () => {
      toast.custom((t) => (
        <Toast
          id={t}
          title="Success!"
          description="Your operation completed successfully."
          variant="success"
        />
      ));
    };

    const showErrorToast = () => {
      toast.custom((t) => (
        <Toast
          id={t}
          title="Error"
          description="Failed to process your request."
          variant="error"
        />
      ));
    };

    const showWarningToast = () => {
      toast.custom((t) => (
        <Toast
          id={t}
          title="Warning"
          description="Please review your input before continuing."
          variant="warning"
        />
      ));
    };

    const showInfoToast = () => {
      toast.custom((t) => (
        <Toast
          id={t}
          title="Information"
          description="New features are now available in your dashboard."
          variant="info"
        />
      ));
    };

    const showToastWithAction = () => {
      toast.custom((t) => (
        <Toast
          id={t}
          title="File Upload"
          description="Your file is ready for download."
          variant="success"
          action={{
            label: 'Download',
            onClick: () => alert('Download started!'),
          }}
        />
      ));
    };

    return (
      <div className="flex flex-col gap-4">
        <h3 className="text-lg font-semibold text-white mb-2">
          Try Interactive Toasts
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="success" onClick={showSuccessToast}>
            Show Success
          </Button>
          <Button variant="danger" onClick={showErrorToast}>
            Show Error
          </Button>
          <Button variant="secondary" onClick={showWarningToast}>
            Show Warning
          </Button>
          <Button variant="primary" onClick={showInfoToast}>
            Show Info
          </Button>
        </div>
        <Button variant="primary" onClick={showToastWithAction} fullWidth>
          Show Toast with Action
        </Button>

        <div className="mt-4 p-3 bg-gray-700 rounded text-sm text-gray-300">
          <p className="font-medium mb-1">Note:</p>
          <p>
            Click the buttons above to see the toasts appear. They will
            automatically disappear after a few seconds or can be dismissed
            manually.
          </p>
        </div>
      </div>
    );
  },
};

// Different Toast Scenarios
export const ToastScenarios: Story = {
  render: () => {
    const scenarios = [
      {
        label: 'Save Success',
        action: () =>
          toast.custom((t) => (
            <Toast
              id={t}
              title="Saved"
              description="Your changes have been saved."
              variant="success"
            />
          )),
      },
      {
        label: 'Network Error',
        action: () =>
          toast.custom((t) => (
            <Toast
              id={t}
              title="Connection Failed"
              description="Unable to connect to the server. Check your internet connection."
              variant="error"
            />
          )),
      },
      {
        label: 'Storage Warning',
        action: () =>
          toast.custom((t) => (
            <Toast
              id={t}
              title="Storage Almost Full"
              description="You're running low on storage space."
              variant="warning"
              action={{
                label: 'Manage Storage',
                onClick: () => alert('Opening storage management...'),
              }}
            />
          )),
      },
      {
        label: 'Feature Update',
        action: () =>
          toast.custom((t) => (
            <Toast
              id={t}
              title="New Feature Available"
              description="Check out the latest updates in your dashboard."
              variant="info"
              action={{
                label: 'Learn More',
                onClick: () => alert('Opening feature guide...'),
              }}
            />
          )),
      },
      {
        label: 'Form Validation',
        action: () =>
          toast.custom((t) => (
            <Toast
              id={t}
              title="Invalid Input"
              description="Please check the email address format."
              variant="error"
            />
          )),
      },
      {
        label: 'Copy to Clipboard',
        action: () =>
          toast.custom((t) => (
            <Toast
              id={t}
              title="Copied!"
              description="Link copied to clipboard."
              variant="success"
            />
          )),
      },
    ];

    return (
      <div className="flex flex-col gap-4 max-w-md">
        <h3 className="text-lg font-semibold text-white mb-2">
          Common Toast Scenarios
        </h3>
        <div className="grid grid-cols-1 gap-2">
          {scenarios.map((scenario, index) => (
            <Button
              key={scenario.label + index.toString()}
              variant="ghost"
              onClick={scenario.action}
              className="justify-start"
            >
              {scenario.label}
            </Button>
          ))}
        </div>

        <div className="mt-4 p-3 bg-gray-700 rounded text-sm text-gray-300">
          <p className="font-medium mb-1">Usage Examples:</p>
          <p>
            These represent common scenarios where toasts are used in
            applications for user feedback and notifications.
          </p>
        </div>
      </div>
    );
  },
};

// Multiple Toasts Demo
export const MultipleToasts: Story = {
  render: () => {
    const showMultipleToasts = () => {
      const toasts = [
        { title: 'First notification', variant: 'info' as const },
        { title: 'Second notification', variant: 'success' as const },
        { title: 'Third notification', variant: 'warning' as const },
        { title: 'Final notification', variant: 'error' as const },
      ];

      toasts.forEach((toastData, index) => {
        setTimeout(() => {
          toast.custom((t) => (
            <Toast
              id={t}
              title={toastData.title}
              description={`This is notification #${index + 1}`}
              variant={toastData.variant}
            />
          ));
        }, index * 500);
      });
    };

    const clearAllToasts = () => {
      toast.dismiss();
    };

    return (
      <div className="flex flex-col gap-4">
        <h3 className="text-lg font-semibold text-white mb-2">
          Multiple Toasts
        </h3>
        <div className="flex gap-3">
          <Button variant="primary" onClick={showMultipleToasts}>
            Show Multiple Toasts
          </Button>
          <Button variant="secondary" onClick={clearAllToasts}>
            Clear All
          </Button>
        </div>

        <div className="mt-4 p-3 bg-gray-700 rounded text-sm text-gray-300">
          <p className="font-medium mb-1">Demo:</p>
          <p>
            This will show multiple toasts in sequence. You can also dismiss all
            toasts at once using the Clear All button.
          </p>
        </div>
      </div>
    );
  },
};
