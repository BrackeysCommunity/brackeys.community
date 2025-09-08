import { motion } from 'motion/react';
import type { ResolvedThemeInterface } from 'redoc';
import { RedocStandalone } from 'redoc';
import { useLayoutProps } from '../context/layoutContext';
import { useDocTitle } from '../hooks/useDocTitle';
import { useRemoveAllEventListeners } from '../hooks/useRemoveAllEventListeners';

const createColorSetting = (
  main: string,
  light: string,
  dark: string,
  contrastText = '#ffffff'
) => ({
  main,
  light,
  dark,
  contrastText,
});

const brackeysTheme: ResolvedThemeInterface = {
  spacing: {
    unit: 4,
    sectionHorizontal: 40,
    sectionVertical: 40,
  },
  breakpoints: {
    small: '50rem',
    medium: '75rem',
    large: '105rem',
  },
  colors: {
    tonalOffset: 0.2,
    primary: createColorSetting('#5865f2', '#a5acf8', '#353d96'),
    success: createColorSetting('#32CC5F', '#69da87', '#299e4b'),
    warning: createColorSetting('#FFA949', '#ffbc6f', '#e69a42'),
    error: createColorSetting('#D2356B', '#e05c8a', '#ab2a57'),
    gray: {
      50: '#f8f9fa',
      100: '#f1f3f5',
    },
    border: {
      light: '#ebe6e7',
      dark: '#ebe6e7',
    },
    text: {
      primary: '#d1d5dc',
      secondary: '#d1d5dc',
    },
    responses: {
      success: {
        color: '#32CC5F',
        backgroundColor: 'rgba(50, 204, 95, 0.1)',
        tabTextColor: '#32CC5F',
      },
      error: {
        color: '#D2356B',
        backgroundColor: 'rgba(210, 53, 107, 0.1)',
        tabTextColor: '#D2356B',
      },
      redirect: {
        color: '#FFA949',
        backgroundColor: 'rgba(255, 169, 73, 0.1)',
        tabTextColor: '#FFA949',
      },
      info: {
        color: '#5865f2',
        backgroundColor: 'rgba(88, 101, 242, 0.1)',
        tabTextColor: '#5865f2',
      },
    },
    http: {
      get: '#32CC5F',
      post: '#5865f2',
      put: '#FFA949',
      options: '#9B70D0',
      patch: '#D2356B',
      delete: '#E96464',
      basic: '#999',
      link: '#31BDF2',
      head: '#c1c1c1',
    },
  },
  schema: {
    linesColor: '#d1d5dc',
    defaultDetailsWidth: '75%',
    typeNameColor: '#353d96',
    typeTitleColor: '#353d96',
    requireLabelColor: '#D2356B',
    labelsTextSize: '0.9em',
    nestingSpacing: '1em',
    nestedBackground: '#1e2939',
    arrow: {
      size: '1.1em',
      color: '#5865f2',
    },
  },
  typography: {
    fontSize: '16px',
    lineHeight: '1.5em',
    fontWeightLight: '300',
    fontWeightRegular: '400',
    fontWeightBold: '600',
    fontFamily:
      'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif',
    smoothing: 'antialiased',
    optimizeSpeed: true,
    code: {
      fontSize: '14px',
      fontFamily: 'Monaco, monospace',
      lineHeight: '1.5em',
      fontWeight: '400',
      color: '#ebe6e7',
      backgroundColor: '#1e2939',
      wrap: true,
    },
    headings: {
      fontFamily:
        'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif',
      fontWeight: '600',
      lineHeight: '1.2em',
    },
    links: {
      color: '#5865f2',
      visited: '#353d96',
      hover: '#8389f5',
      textDecoration: 'none',
      hoverTextDecoration: 'underline',
    },
  },
  sidebar: {
    width: '300px',
    backgroundColor: '#1e2939',
    textColor: '#d1d5dc',
    activeTextColor: '#5865f2',
    groupItems: {
      activeBackgroundColor: 'rgba(88, 101, 242, 0.1)',
      activeTextColor: '#5865f2',
      textTransform: 'uppercase',
    },
    level1Items: {
      activeBackgroundColor: 'rgba(88, 101, 242, 0.1)',
      activeTextColor: '#5865f2',
      textTransform: 'none',
    },
    arrow: {
      size: '1.5em',
      color: '#5865f2',
    },
  },
  logo: {
    maxHeight: '50px',
    maxWidth: '200px',
    gutter: '20px',
  },
  rightPanel: {
    backgroundColor: '#1e2939',
    textColor: '#d1d5dc',
    width: '40%',
    servers: {
      overlay: {
        backgroundColor: '#1e2939',
        textColor: '#d1d5dc',
      },
      url: {
        backgroundColor: 'rgba(0, 0, 0, 0.2)',
      },
    },
  },
  codeBlock: {
    backgroundColor: '#1e2939',
  },
  fab: {
    backgroundColor: '#5865f2',
    color: '#d1d5dc',
  },
};

export const Api = () => {
  useLayoutProps({
    showFooter: false,
    containerized: false,
    mainClassName: 'px-0 pt-0',
  });

  // TODO: Remove this when Redoc is fixed
  useRemoveAllEventListeners('scroll');
  useDocTitle('API - Brackeys Community');

  return (
    <div className="w-full">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <RedocStandalone
          specUrl="swagger.yml"
          options={{
            theme: brackeysTheme,
            hideDownloadButton: true,
            disableSearch: true,
            expandResponses: '200,201',
            requiredPropsFirst: true,
            sortPropsAlphabetically: false,
            nativeScrollbars: true,
            hideHostname: false,
            hideLoading: false,
            showExtensions: false,
            scrollYOffset: 130,
          }}
          onLoaded={() => {
            window.removeEventListener('scroll', () => {});
          }}
        />
      </motion.div>
    </div>
  );
};
