import type { Preview } from '@storybook/react-vite';
import { Toaster } from 'sonner';
import React from 'react';
import '../src/styles.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'dark',
      values: [
        {
          name: 'dark',
          value: '#111827', // gray-900
        },
        {
          name: 'light',
          value: '#ffffff',
        },
      ],
    },
    docs: {
      theme: {
        base: 'dark',
        colorPrimary: '#8b5cf6', // brackeys-purple
        colorSecondary: '#6b7280', // gray-500

        // UI
        appBg: '#111827', // gray-900 - matches your app
        appContentBg: '#1f2937', // gray-800
        appBorderColor: '#374151', // gray-700
        appBorderRadius: 6,

        // Typography
        fontBase:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
        fontCode:
          'source-code-pro, Menlo, Monaco, Consolas, "Courier New", monospace',

        // Text colors
        textColor: '#f9fafb', // gray-50
        textInverseColor: '#111827', // gray-900
        textMutedColor: '#9ca3af', // gray-400

        // Toolbar default and active colors
        barTextColor: '#d1d5db', // gray-300
        barSelectedColor: '#8b5cf6', // brackeys-purple
        barBg: '#1f2937', // gray-800

        // Form colors
        inputBg: '#374151', // gray-700
        inputBorder: '#4b5563', // gray-600
        inputTextColor: '#f9fafb', // gray-50
        inputBorderRadius: 4,
      },
    },
    options: {
      storySort: {
        order: [
          'Overview',
          'UI',
          ['Button', 'Input', 'Loading', 'Modal', 'Toast'],
          '*',
        ],
      },
    },
    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: 'todo',
    },
  },
  decorators: [
    (Story) =>
      React.createElement('div', { style: { padding: '1rem' } }, [
        React.createElement(Story, { key: 'story' }),
        React.createElement(Toaster, {
          key: 'toaster',
          position: 'top-right',
          expand: true,
          richColors: true,
          theme: 'dark',
        }),
      ]),
  ],
};

export default preview;
