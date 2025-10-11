export const CURSOR_UPDATE_THRESHOLD = 0.2; // px
export const CURSOR_UPDATE_INTERVAL = 50;

export const MAX_TYPING_LENGTH = 200;
export const MAX_NAME_LENGTH = 20;

export const CURSOR_ANIMATION_CONFIG = {
  opacity: { duration: 0.05 },
  scale: { duration: 0.05 },
} as const;

export const TYPING_ANIMATION_CONFIG = {
  type: 'spring' as const,
  stiffness: 300,
  damping: 25,
};

export const TYPING_BUBBLE_TRANSITIONS = {
  opacity: { duration: 0.1 },
  height: { duration: 0.1 },
} as const;

export const CURSOR_SHADOW_FILTER =
  'drop-shadow(0 2px 8px rgba(0,0,0,0.6)) drop-shadow(0 0 0 1px rgba(255,255,255,0.8))';
export const CURSOR_PATH = 'M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z';

export const TYPING_BLUR_TIMEOUT = 200;

export const MESSAGE_FADE_OUT_DELAY_MS = 8000;
export const MESSAGE_POSITION_TOLERANCE_PX = 5;
