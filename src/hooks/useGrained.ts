import { useEffect, useRef } from 'react';

type GrainedOptions = {
  animate?: boolean;
  patternWidth?: number;
  patternHeight?: number;
  grainOpacity?: number;
  grainDensity?: number;
  grainWidth?: number;
  grainHeight?: number;
};

function generateNoise(
  patternWidth: number,
  patternHeight: number,
  grainDensity: number,
  grainWidth: number,
  grainHeight: number,
): string {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) return '';

  canvas.width = patternWidth;
  canvas.height = patternHeight;

  for (let w = 0; w < patternWidth; w += grainDensity) {
    for (let h = 0; h < patternHeight; h += grainDensity) {
      const rgb = (Math.random() * 256) | 0;
      ctx.fillStyle = `rgba(${rgb}, ${rgb}, ${rgb}, 1)`;
      ctx.fillRect(w, h, grainWidth, grainHeight);
    }
  }

  return canvas.toDataURL('image/png');
}

export function useGrained(
  containerRef: React.RefObject<HTMLElement | HTMLDivElement> | null,
  options: GrainedOptions = {},
) {
  const grainedDivRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!containerRef) return;
    const container = containerRef.current;
    if (!container) return;

    const {
      animate = true,
      patternWidth = 100,
      patternHeight = 100,
      grainOpacity = 0.05,
      grainDensity = 1,
      grainWidth = 1,
      grainHeight = 1,
    } = options;

    // Create the grained div
    const grainedDiv = document.createElement('div');
    grainedDiv.className = 'grained';

    // Generate noise pattern
    const noisePattern = generateNoise(
      patternWidth,
      patternHeight,
      grainDensity,
      grainWidth,
      grainHeight,
    );

    // Apply styles
    Object.assign(grainedDiv.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '1',
      opacity: String(grainOpacity),
      backgroundImage: `url(${noisePattern})`,
      backgroundRepeat: 'repeat',
    });

    // Ensure container has relative positioning
    const containerPosition = window.getComputedStyle(container).position;
    if (containerPosition !== 'absolute' && containerPosition !== 'relative') {
      container.style.position = 'relative';
    }
    container.style.overflow = 'hidden';

    // Insert as first child
    container.insertBefore(grainedDiv, container.firstChild);
    grainedDivRef.current = grainedDiv;

    // Add animation if enabled
    if (animate) {
      let frame = 0;
      const animationFrames = 8;
      const patterns: string[] = [];

      // Pre-generate animation frames
      for (let i = 0; i < animationFrames; i++) {
        patterns.push(
          generateNoise(
            patternWidth,
            patternHeight,
            grainDensity,
            grainWidth,
            grainHeight,
          ),
        );
      }

      function animateGrain() {
        if (grainedDiv && patterns.length > 0) {
          grainedDiv.style.backgroundImage = `url(${patterns[frame % animationFrames]})`;
          frame++;
        }
        animationRef.current = requestAnimationFrame(animateGrain);
      }

      animateGrain();
    }

    // Cleanup
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (grainedDiv.parentNode) {
        grainedDiv.parentNode.removeChild(grainedDiv);
      }
    };
  }, [
    containerRef,
    options.animate,
    options.grainOpacity,
    options.grainDensity,
    options.grainWidth,
    options.grainHeight,
    options.patternWidth,
    options.patternHeight,
  ]);

  return grainedDivRef;
}
