declare module 'grained' {
  // grained.js is an IIFE that adds itself to window.grained
  // Importing it will execute the script and make window.grained available
  const _default: void;
  export default _default;
}

declare global {
  interface Window {
    grained?: (
      selector: string,
      options?: {
        animate?: boolean;
        patternWidth?: number;
        patternHeight?: number;
        grainOpacity?: number;
        grainDensity?: number;
        grainWidth?: number;
        grainHeight?: number;
      },
    ) => void;
  }
}
