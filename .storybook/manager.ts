import { addons } from 'storybook/manager-api';
import { themes } from 'storybook/theming';

addons.setConfig({
  theme: {
    ...themes.dark,

    // Brand
    brandTitle: 'Brackeys UI Components',
    brandUrl: 'https://discord.gg/brackeys',

    // Colors
    colorPrimary: '#8b5cf6', // brackeys-purple
    colorSecondary: '#6b7280', // gray-500

    // UI
    appBg: '#0f172a', // slate-900 - darker for manager
    appContentBg: '#111827', // gray-900
    appPreviewBg: '#111827', // gray-900
    appBorderColor: '#374151', // gray-700
    appBorderRadius: 6,

    // Text colors
    textColor: '#f1f5f9', // slate-100
    textInverseColor: '#0f172a', // slate-900
    textMutedColor: '#94a3b8', // slate-400

    // Toolbar
    barTextColor: '#cbd5e1', // slate-300
    barHoverColor: '#8b5cf6', // brackeys-purple
    barSelectedColor: '#8b5cf6', // brackeys-purple
    barBg: '#1e293b', // slate-800

    // Form colors
    inputBg: '#334155', // slate-700
    inputBorder: '#475569', // slate-600
    inputTextColor: '#f1f5f9', // slate-100
    inputBorderRadius: 4,

    // Button colors
    buttonBg: '#475569', // slate-600
    buttonBorder: '#64748b', // slate-500
    booleanBg: '#334155', // slate-700
    booleanSelectedBg: '#8b5cf6', // brackeys-purple
  },
}); 