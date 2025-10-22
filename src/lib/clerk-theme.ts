import type { Appearance } from '@clerk/types'

/**
 * Shared Clerk appearance configuration for the Brackeys Community theme.
 * This theme uses dark mode with purple/fuscia accents to match our brand.
 */
export const clerkAppearance: Appearance = {
  baseTheme: undefined,
  variables: {
    colorPrimary: '#5865f2', // brackeys-purple-500
    colorBackground: '#1f2937', // gray-800
    colorInputBackground: '#111827', // gray-900
    colorInputText: '#f3f4f6', // gray-100
    colorText: '#f3f4f6', // gray-100
    colorTextSecondary: '#d1d5db', // gray-300
    colorTextOnPrimaryBackground: '#ffffff',
    colorDanger: '#ef4444', // red-500
    colorSuccess: '#10b981', // green-500
    colorWarning: '#f59e0b', // amber-500
    borderRadius: '0.75rem',
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    fontSize: '0.875rem',
    fontWeight: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
  },
  elements: {
    // Root and Layout
    rootBox: '!w-full !rounded-3xl',
    card: '!bg-gray-800 !border !border-gray-700 !shadow-lg',
    cardBox: '!w-auto',
    navbar: '!bg-gray-800 !border-r !border-gray-700',
    scrollBox: '!bg-gray-800',

    // Navigation
    navbarButton:
      '!text-gray-300 hover:!text-white hover:!bg-gray-700/50 !rounded-lg',
    navbarButtonIcon: '!text-gray-400',
    navbarMobileMenuButton: '!text-gray-300',

    // Page
    pageScrollBox: '!bg-gray-800',
    page: '!bg-gray-800 !text-gray-200',

    // Profile sections
    profilePage: 'space-y-4',
    profileSection:
      '!bg-gray-900/50 !border !border-gray-700 !rounded-lg !p-4',
    profileSectionTitle: '!text-white !font-semibold !text-base',
    profileSectionContent: '!text-gray-300',
    profileSectionPrimaryButton:
      '!text-brackeys-purple-400 hover:!text-brackeys-purple-300 !font-medium',
    profileSectionItem: '!text-gray-200',

    // Forms
    formFieldLabel: '!text-gray-200 !font-medium',
    formFieldInput:
      '!bg-gray-900 !border-gray-600 !text-white placeholder:!text-gray-500 focus:!border-brackeys-purple-500',
    formFieldInputShowPasswordButton: '!text-gray-400 hover:!text-gray-300',
    formFieldSuccessText: '!text-green-400',
    formFieldErrorText: '!text-red-400',
    formFieldHintText: '!text-gray-400',
    formFieldAction:
      '!text-brackeys-purple-400 hover:!text-brackeys-purple-300',

    // Form Headers
    formHeaderTitle: '!text-white !font-semibold',
    formHeaderSubtitle: '!text-gray-400',

    // Buttons
    formButtonPrimary:
      '!bg-brackeys-purple-500 hover:!bg-brackeys-purple-600 !text-white !font-medium',
    formButtonReset: '!text-gray-300 hover:!text-gray-200 !border-gray-600',

    // Badge and Avatar
    badge: '!bg-brackeys-purple-600 !text-white',
    avatarBox: '!border-2 !border-brackeys-purple-500',

    // User Preview
    userPreviewMainIdentifier: '!text-white !font-semibold',
    userPreviewSecondaryIdentifier: '!text-gray-400',

    // Identity Preview
    identityPreviewText: '!text-gray-200',
    identityPreviewEditButton:
      '!text-brackeys-purple-400 hover:!text-brackeys-purple-300',

    // Accordion
    accordionTriggerButton: '!text-gray-200 hover:!text-white',
    accordionContent: '!text-gray-300',

    // Menu
    menuButton: '!text-gray-300 hover:!text-white hover:!bg-gray-700/50',
    menuItem: '!text-gray-200 hover:!text-white hover:!bg-gray-700/50',

    // Table
    tableHead: '!text-gray-400 !font-medium',
    tableCellPrimary: '!text-white',
    tableCellSecondary: '!text-gray-400',

    // Breadcrumbs
    breadcrumbsItem: '!text-gray-400',
    breadcrumbsItemDivider: '!text-gray-600',

    // Modal
    modalContent: '!bg-gray-800 !text-gray-200 !rounded-3xl',
    modalCloseButton: '!text-gray-400 hover:!text-gray-300',

    // Divider
    dividerLine: '!bg-gray-700',
    dividerText: '!text-gray-400',

    // Footer
    footerActionLink:
      '!text-brackeys-purple-400 hover:!text-brackeys-purple-300',
    footerActionText: '!text-gray-400',
    footerPages: '!bg-gray-800',

    // Active Device
    activeDevice: '!text-white',
    activeDeviceIcon: '!text-gray-400',

    // OTP Code Field
    otpCodeFieldInput: '!bg-gray-900 !border-gray-600 !text-white',

    // User Button (Dropdown)
    userButtonPopoverCard: '!bg-gray-800 !border !border-gray-700 !shadow-xl',
    userButtonPopoverActionButton:
      '!text-gray-200 hover:!text-white hover:!bg-gray-700/50',
    userButtonPopoverActionButtonIcon: '!text-gray-400',
    userButtonPopoverActionButtonText: '!text-gray-200',
    userButtonPopoverFooter: '!bg-gray-900/50 !border-t !border-gray-700',

    // User Button Trigger
    // userButtonBox: '!border-2 !border-transparent',
    userButtonOuterIdentifier: '!text-gray-200',
    userButtonTrigger: 'hover:!opacity-80 !transition-opacity',

    // Alert
    alertText: '!text-gray-200',

    // Social Buttons
    socialButtonsBlockButton:
      '!bg-gray-900 !border-gray-600 !text-gray-200 hover:!bg-gray-800',
    socialButtonsBlockButtonText: '!text-gray-200 !font-medium',

    // Internal (sign in/sign up forms)
    internal: '!bg-gray-800',
  },
}

