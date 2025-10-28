// Color utilities for generating palettes and derived colors
getComputedStyle(document.documentElement);

export type ColorScheme = {
  main: string;
  outline: string;
  contrastText: string;
  selection: string;
  hover: string;
  shadow: string;
  selectionText: string;
  baseText: string;
  caretColor: string;
};

// Generate 12 evenly distributed colors across the rainbow spectrum
export const RAINBOW_PALETTE = [
  'hsl(0, 70%, 55%)', // Red
  'hsl(30, 70%, 55%)', // Orange
  'hsl(60, 70%, 55%)', // Yellow
  'hsl(90, 70%, 55%)', // Yellow-Green
  'hsl(120, 70%, 55%)', // Green
  'hsl(150, 70%, 55%)', // Mint
  'hsl(180, 70%, 55%)', // Cyan
  'hsl(210, 70%, 55%)', // Sky Blue
  'hsl(240, 70%, 55%)', // Blue
  'hsl(270, 70%, 55%)', // Purple
  'hsl(300, 70%, 55%)', // Magenta
  'hsl(330, 70%, 55%)', // Pink
];

// Hardcoded color schemes for each palette color
const COLOR_SCHEMES: Record<string, ColorScheme> = {
  // Red
  'hsl(0, 70%, 55%)': {
    main: 'hsl(0, 70%, 55%)',
    outline: 'hsl(0, 80%, 70%)', // Dark red
    contrastText: 'hsl(0, 100%, 95%)', // Very light red/pink
    selection: 'hsl(0, 80%, 80%)', // Bright red
    hover: 'hsl(0, 70%, 45%)', // Darker red
    shadow: 'hsla(0, 70%, 20%, 0.3)', // Very dark red
    selectionText: 'hsl(0, 100%, 25%)', // Light pink
    baseText: 'hsl(0, 100%, 95%)', // Very light red/pink
    caretColor: 'hsl(0, 70%, 85%)',
  },

  // Orange
  'hsl(30, 70%, 55%)': {
    main: 'hsl(30, 70%, 55%)',
    outline: 'hsl(30, 80%, 70%)', // Light orange
    contrastText: 'hsl(30, 100%, 95%)', // Very light orange
    selection: 'hsl(30, 80%, 80%)', // Bright orange
    hover: 'hsl(30, 70%, 45%)', // Darker orange
    shadow: 'hsla(30, 70%, 20%, 0.3)', // Very dark orange
    selectionText: 'hsl(30, 100%, 25%)', // Dark orange
    baseText: 'hsl(30, 100%, 95%)', // Very dark orange/brown
    caretColor: 'hsl(30, 70%, 85%)',
  },

  // Yellow
  'hsl(60, 70%, 55%)': {
    main: 'hsl(60, 70%, 55%)',
    outline: 'hsl(60, 80%, 70%)', // Light yellow
    contrastText: 'hsl(60, 100%, 10%)', // Very dark yellow
    selection: 'hsl(60, 80%, 80%)', // Bright yellow
    hover: 'hsl(60, 70%, 45%)', // Darker yellow
    shadow: 'hsla(60, 70%, 20%, 0.3)', // Very dark yellow
    selectionText: 'hsl(60, 100%, 25%)', // Dark yellow
    baseText: 'hsl(60, 100%, 10%)', // Very dark yellow/brown
    caretColor: 'hsl(60, 70%, 85%)',
  },

  // Yellow-Green
  'hsl(90, 70%, 55%)': {
    main: 'hsl(90, 70%, 55%)',
    outline: 'hsl(90, 80%, 70%)', // Light yellow-green
    contrastText: 'hsl(90, 100%, 10%)', // Very dark green
    selection: 'hsl(90, 80%, 80%)', // Bright yellow-green
    hover: 'hsl(90, 70%, 45%)', // Darker yellow-green
    shadow: 'hsla(90, 70%, 20%, 0.3)', // Very dark yellow-green
    selectionText: 'hsl(90, 100%, 25%)', // Dark yellow-green
    baseText: 'hsl(90, 100%, 10%)', // Very dark green
    caretColor: 'hsl(90, 70%, 85%)',
  },

  // Green
  'hsl(120, 70%, 55%)': {
    main: 'hsl(120, 70%, 55%)',
    outline: 'hsl(120, 80%, 70%)', // Light green
    contrastText: 'hsl(120, 100%, 95%)', // Very light green
    selection: 'hsl(120, 80%, 80%)', // Bright green
    hover: 'hsl(120, 70%, 45%)', // Darker green
    shadow: 'hsla(120, 70%, 20%, 0.3)', // Very dark green
    selectionText: 'hsl(120, 100%, 25%)', // Dark green
    baseText: 'hsl(120, 100%, 95%)', // Very dark green
    caretColor: 'hsl(120, 70%, 85%)',
  },

  // Mint
  'hsl(150, 70%, 55%)': {
    main: 'hsl(150, 70%, 55%)',
    outline: 'hsl(150, 80%, 70%)', // Light mint
    contrastText: 'hsl(150, 100%, 10%)', // Very dark mint
    selection: 'hsl(150, 80%, 80%)', // Bright mint
    hover: 'hsl(150, 70%, 45%)', // Darker mint
    shadow: 'hsla(150, 70%, 20%, 0.3)', // Very dark mint
    selectionText: 'hsl(150, 100%, 25%)', // Dark mint
    baseText: 'hsl(150, 100%, 10%)', // Very dark mint
    caretColor: 'hsl(150, 70%, 85%)',
  },

  // Cyan
  'hsl(180, 70%, 55%)': {
    main: 'hsl(180, 70%, 55%)',
    outline: 'hsl(180, 80%, 70%)', // Light cyan
    contrastText: 'hsl(180, 100%, 10%)', // Very dark cyan
    selection: 'hsl(180, 80%, 80%)', // Bright cyan
    hover: 'hsl(180, 70%, 45%)', // Darker cyan
    shadow: 'hsla(180, 70%, 20%, 0.3)', // Very dark cyan
    selectionText: 'hsl(180, 100%, 25%)', // Dark cyan
    baseText: 'hsl(180, 100%, 10%)', // Very dark cyan
    caretColor: 'hsl(180, 70%, 85%)',
  },

  // Sky Blue
  'hsl(210, 70%, 55%)': {
    main: 'hsl(210, 70%, 55%)',
    outline: 'hsl(210, 80%, 70%)', // Light sky blue
    contrastText: 'hsl(210, 100%, 95%)', // Very light blue
    selection: 'hsl(210, 80%, 80%)', // Bright sky blue
    hover: 'hsl(210, 70%, 45%)', // Darker sky blue
    shadow: 'hsla(210, 70%, 15%, 0.3)', // Very dark blue
    selectionText: 'hsl(210, 100%, 25%)', // Dark sky blue
    baseText: 'hsl(210, 100%, 95%)', // Very light blue
    caretColor: 'hsl(210, 70%, 85%)',
  },

  // Blue
  'hsl(240, 70%, 55%)': {
    main: 'hsl(240, 70%, 55%)',
    outline: 'hsl(240, 80%, 70%)', // Light blue
    contrastText: 'hsl(240, 100%, 95%)', // Very light blue
    selection: 'hsl(240, 80%, 80%)', // Bright blue
    hover: 'hsl(240, 70%, 45%)', // Darker blue
    shadow: 'hsla(240, 70%, 15%, 0.3)', // Very dark blue
    selectionText: 'hsl(240, 100%, 25%)', // Dark blue
    baseText: 'hsl(240, 100%, 95%)', // Very light blue
    caretColor: 'hsl(240, 70%, 85%)',
  },

  // Purple
  'hsl(270, 70%, 55%)': {
    main: 'hsl(270, 70%, 55%)',
    outline: 'hsl(270, 80%, 70%)', // Light purple
    contrastText: 'hsl(270, 100%, 95%)', // Very light purple
    selection: 'hsl(270, 80%, 80%)', // Bright purple
    hover: 'hsl(270, 70%, 45%)', // Darker purple
    shadow: 'hsla(270, 70%, 15%, 0.3)', // Very dark purple
    selectionText: 'hsl(270, 100%, 25%)', // Dark purple
    baseText: 'hsl(270, 100%, 95%)', // Very light purple
    caretColor: 'hsl(270, 70%, 85%)',
  },

  // Magenta
  'hsl(300, 70%, 55%)': {
    main: 'hsl(300, 70%, 55%)',
    outline: 'hsl(300, 80%, 70%)', // Light magenta
    contrastText: 'hsl(300, 100%, 95%)', // Very light magenta
    selection: 'hsl(300, 80%, 80%)', // Bright magenta
    hover: 'hsl(300, 70%, 45%)', // Darker magenta
    shadow: 'hsla(300, 70%, 15%, 0.3)', // Very dark magenta
    selectionText: 'hsl(300, 100%, 25%)', // Dark magenta
    baseText: 'hsl(300, 100%, 95%)', // Very light magenta
    caretColor: 'hsl(300, 70%, 85%)',
  },

  // Pink
  'hsl(330, 70%, 55%)': {
    main: 'hsl(330, 70%, 55%)',
    outline: 'hsl(330, 80%, 70%)', // Light pink
    contrastText: 'hsl(330, 100%, 95%)', // Very light pink
    selection: 'hsl(330, 80%, 80%)', // Bright pink
    hover: 'hsl(330, 70%, 45%)', // Darker pink
    shadow: 'hsla(330, 70%, 15%, 0.3)', // Very dark pink
    selectionText: 'hsl(330, 100%, 25%)', // Dark pink
    baseText: 'hsl(330, 100%, 95%)', // Very light pink
    caretColor: 'hsl(330, 70%, 85%)',
  },
};

// Generate a complete color scheme from a main color
export function generateColorScheme(mainColor: string): ColorScheme {
  // Return the hardcoded scheme if it exists
  const scheme = COLOR_SCHEMES[mainColor];
  if (scheme) {
    return scheme;
  }

  // Fallback for any color not in our palette
  return {
    main: mainColor,
    outline: 'rgba(0, 0, 0, 0.2)',
    contrastText: '#000000',
    selection: 'rgba(0, 0, 0, 0.1)',
    hover: mainColor,
    shadow: 'rgba(0, 0, 0, 0.3)',
    selectionText: '#000000',
    baseText: '#000000',
    caretColor: 'rgba(0, 0, 0, 0.5)',
  };
}

// Get the index of a color in the palette
export function getColorIndex(color: string): number {
  const index = RAINBOW_PALETTE.indexOf(color);
  return index >= 0 ? index : 0;
}

// Format color for display (add gradient effect)
export function getColorGradient(color: string): string {
  // Parse HSL values
  const match = color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!match) return color;

  const h = parseInt(match[1], 10);
  const s = parseInt(match[2], 10);
  const l = parseInt(match[3], 10);

  const lighter = `hsl(${h}, ${Math.max(s - 10, 40)}%, ${Math.min(l + 15, 85)}%)`;
  const darker = `hsl(${h}, ${Math.min(s + 10, 90)}%, ${Math.max(l - 10, 30)}%)`;
  return `linear-gradient(135deg, ${lighter} 0%, ${color} 50%, ${darker} 100%)`;
}
