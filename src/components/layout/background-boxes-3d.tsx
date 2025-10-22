import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface BoxesProps {
  className?: string;
}

interface Cube {
  row: number;
  col: number;
  color: string | null;
  fadeProgress: number;
  yOffset: number;
  yVelocity: number;
  targetY: number;
}

// Brackeys brand colors for the wave gradient
const BRACKEYS_COLORS = [
  { r: 255, g: 169, b: 73 },   // brackeys-yellow: #ffa949
  { r: 210, g: 53, b: 107 },   // brackeys-fuscia: #d2356b
  { r: 88, g: 101, b: 242 },   // brackeys-purple-500: #5865f2
];

export const Boxes = ({ className, ...rest }: BoxesProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const cubesRef = useRef<Map<string, Cube>>(new Map());
  const animationFrameRef = useRef<number | undefined>(undefined);
  const currentHoverRef = useRef<string | null>(null);
  const lastTriggeredCubeRef = useRef<string | null>(null);
  const colorPositionRef = useRef<number>(0); // 0 to 1, continuously incrementing
  const lastHoverPositionRef = useRef<{ row: number; col: number; time: number } | null>(null);
  const velocityRef = useRef<{ speed: number; dirX: number; dirY: number }>({ speed: 0, dirX: 0, dirY: 0 });
  const lastFrameTimeRef = useRef<number>(performance.now());

  const CUBE_WIDTH = 100; // Width of cube
  const CUBE_HEIGHT = 120; // Height of cube
  const ROWS = 45;
  const COLS = 45;

  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        const parent = canvasRef.current.parentElement;
        if (parent) {
          setDimensions({
            width: parent.offsetWidth,
            height: parent.offsetHeight,
          });
        }
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size - using simpler approach without DPR scaling for mouse tracking
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    // Function to get next color by interpolating through the gradient
    const getNextColor = (): string => {
      // Increment position by a small amount to smoothly progress through colors
      colorPositionRef.current = (colorPositionRef.current + 0.05) % 1;

      // Map position (0-1) to the color array
      const scaledPosition = colorPositionRef.current * BRACKEYS_COLORS.length;
      const lowerIndex = Math.floor(scaledPosition);
      const upperIndex = (lowerIndex + 1) % BRACKEYS_COLORS.length;
      const t = scaledPosition - lowerIndex; // Interpolation factor between the two colors

      // Interpolate between the two nearest colors
      const lowerColor = BRACKEYS_COLORS[lowerIndex];
      const upperColor = BRACKEYS_COLORS[upperIndex];

      const r = Math.floor(lowerColor.r + (upperColor.r - lowerColor.r) * t);
      const g = Math.floor(lowerColor.g + (upperColor.g - lowerColor.g) * t);
      const b = Math.floor(lowerColor.b + (upperColor.b - lowerColor.b) * t);

      return `rgb(${r}, ${g}, ${b})`;
    };

    // Helper function to lerp between two colors
    const lerpColor = (color1: [number, number, number], color2: [number, number, number], t: number): [number, number, number] => {
      return [
        Math.floor(color1[0] + (color2[0] - color1[0]) * t),
        Math.floor(color1[1] + (color2[1] - color1[1]) * t),
        Math.floor(color1[2] + (color2[2] - color1[2]) * t),
      ];
    };

    // Draw isometric cube face
    const drawCubeFace = (
      x: number,
      y: number,
      width: number,
      height: number,
      face: 'top' | 'left' | 'right',
      color: string | null,
    ) => {
      // gray-900: oklch(21% 0.034 264.665) = rgb(16, 24, 40)
      const baseColor: [number, number, number] = [16, 24, 40]; // gray-900
      const borderColor = 'oklch(25% 0.034 264.665 / 0.5)'; // gray-800/50

      let fillColor: string;
      if (color) {
        // Parse the color
        const rgbMatch = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        if (rgbMatch) {
          const highlightColor: [number, number, number] = [
            Number.parseInt(rgbMatch[1]),
            Number.parseInt(rgbMatch[2]),
            Number.parseInt(rgbMatch[3]),
          ];

          // Apply different shading to each face for 3D effect
          const shadingMultiplier = face === 'top' ? 1 : face === 'left' ? 0.7 : 0.85;
          const shadedColor: [number, number, number] = [
            Math.floor(highlightColor[0] * shadingMultiplier),
            Math.floor(highlightColor[1] * shadingMultiplier),
            Math.floor(highlightColor[2] * shadingMultiplier),
          ];

          fillColor = `rgb(${shadedColor[0]}, ${shadedColor[1]}, ${shadedColor[2]})`;
        } else {
          fillColor = color;
        }
      } else {
        // Apply shading to base color too
        const shadingMultiplier = face === 'top' ? 1 : face === 'left' ? 0.7 : 0.85;
        fillColor = `rgb(${Math.floor(baseColor[0] * shadingMultiplier)}, ${Math.floor(baseColor[1] * shadingMultiplier)}, ${Math.floor(baseColor[2] * shadingMultiplier)})`;
      }

      ctx.beginPath();

      if (face === 'top') {
        // Top face (diamond shape)
        ctx.moveTo(x, y);
        ctx.lineTo(x + width / 2, y - height / 4);
        ctx.lineTo(x + width, y);
        ctx.lineTo(x + width / 2, y + height / 4);
      } else if (face === 'left') {
        // Left face
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + height / 2);
        ctx.lineTo(x + width / 2, y + height / 4 + height / 2);
        ctx.lineTo(x + width / 2, y + height / 4);
      } else if (face === 'right') {
        // Right face
        ctx.moveTo(x + width, y);
        ctx.lineTo(x + width, y + height / 2);
        ctx.lineTo(x + width / 2, y + height / 4 + height / 2);
        ctx.lineTo(x + width / 2, y + height / 4);
      }

      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    const drawCube = (x: number, y: number, color: string | null) => {
      // Draw in order: left, right, top for proper depth
      drawCubeFace(x, y, CUBE_WIDTH, CUBE_HEIGHT, 'left', color);
      drawCubeFace(x, y, CUBE_WIDTH, CUBE_HEIGHT, 'right', color);
      drawCubeFace(x, y, CUBE_WIDTH, CUBE_HEIGHT, 'top', color);
    };

    const screenToGrid = (screenX: number, screenY: number) => {
      // Calculate same offsets as drawing
      const gridHeight = (ROWS + COLS) * (CUBE_HEIGHT / 4);
      const offsetX = dimensions.width / 2;
      const offsetY = dimensions.height / 2 - gridHeight / 2;

      // Adjust mouse position to account for visual center of isometric cube
      // The top face of the cube is offset from the base coordinate
      const adjustedX = screenX - offsetX - (CUBE_WIDTH / 2);
      const adjustedY = screenY - offsetY;

      // Inverse isometric transformation
      const a = adjustedX / (CUBE_WIDTH / 2);
      const b = adjustedY / (CUBE_HEIGHT / 4);

      const col = (a + b) / 2;
      const row = (b - a) / 2;

      return {
        col: Math.round(col),
        row: Math.round(row),
      };
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const { col, row } = screenToGrid(x, y);
      const key = `${row}-${col}`;

      if (row >= 0 && row < ROWS && col >= 0 && col < COLS) {
        currentHoverRef.current = key;

        // Only trigger waves and pick new color if this is a new cube being hovered
        if (lastTriggeredCubeRef.current !== key) {
          lastTriggeredCubeRef.current = key;
          const existingCube = cubesRef.current.get(key);

          // Calculate velocity and direction
          const currentTime = performance.now();
          if (lastHoverPositionRef.current) {
            const deltaRow = row - lastHoverPositionRef.current.row;
            const deltaCol = col - lastHoverPositionRef.current.col;
            const distance = Math.sqrt(deltaRow * deltaRow + deltaCol * deltaCol);
            const deltaTime = currentTime - lastHoverPositionRef.current.time;

            // Calculate velocity (cubes per millisecond, scaled up for visibility)
            const rawSpeed = deltaTime > 0 ? (distance / deltaTime) * 100 : 0;
            velocityRef.current.speed = Math.min(rawSpeed, 15); // Cap at 15

            // Calculate normalized direction vector
            if (distance > 0) {
              velocityRef.current.dirX = deltaCol / distance;
              velocityRef.current.dirY = deltaRow / distance;
            }
          } else {
            velocityRef.current.speed = 1;
            velocityRef.current.dirX = 0;
            velocityRef.current.dirY = 0;
          }

          lastHoverPositionRef.current = { row, col, time: currentTime };

          // Get next color in the sequence
          const waveColor = getNextColor();

          // Set or update the cube with new color
          if (!existingCube) {
            cubesRef.current.set(key, {
              row,
              col,
              color: waveColor,
              fadeProgress: 1,
              yOffset: 0,
              yVelocity: -15, // Initial upward velocity for spring
              targetY: -30, // Target raised position
            });
          } else {
            // Update existing cube with new random color and trigger bounce
            existingCube.color = waveColor;
            existingCube.fadeProgress = 1;
            existingCube.targetY = -30;
            if (existingCube.yOffset > -20) {
              existingCube.yVelocity = -12;
            }
          }

          // Create wave effect with velocity-based radius and directional strength
          const baseRadius = 1;
          const velocityBonus = Math.min(velocityRef.current.speed * 0.5, 7); // Up to +7 radius from velocity
          const waveRadius = baseRadius + velocityBonus;

          for (let dr = -Math.ceil(waveRadius); dr <= Math.ceil(waveRadius); dr++) {
            for (let dc = -Math.ceil(waveRadius); dc <= Math.ceil(waveRadius); dc++) {
              if (dr === 0 && dc === 0) continue;

              const neighborRow = row + dr;
              const neighborCol = col + dc;
              const neighborKey = `${neighborRow}-${neighborCol}`;

              if (neighborRow >= 0 && neighborRow < ROWS && neighborCol >= 0 && neighborCol < COLS) {
                const distance = Math.sqrt(dr * dr + dc * dc);
                if (distance <= waveRadius) {
                  // Calculate directional strength based on velocity
                  let directionalMultiplier = 1;
                  if (velocityRef.current.speed > 0.5) {
                    // Normalize the direction to this neighbor
                    const neighborDirX = dc / distance;
                    const neighborDirY = dr / distance;

                    // Dot product to see alignment with movement direction
                    const alignment = (neighborDirX * velocityRef.current.dirX +
                                     neighborDirY * velocityRef.current.dirY);

                    // Boost strength in direction of movement (1x to 2x)
                    directionalMultiplier = 1 + Math.max(0, alignment) * (velocityRef.current.speed / 10);
                  }

                  // Gentler falloff with directional boost
                  const delayFactor = distance / waveRadius;
                  const baseFalloff = 1 - (distance / waveRadius) * 0.3;
                  const strengthFactor = baseFalloff * directionalMultiplier;

                setTimeout(() => {
                  const neighborCube = cubesRef.current.get(neighborKey);

                  if (!neighborCube) {
                    // Create a wave effect with velocity-based strength
                    cubesRef.current.set(neighborKey, {
                      row: neighborRow,
                      col: neighborCol,
                      color: waveColor,
                      fadeProgress: Math.min(1, 0.8 * strengthFactor),
                      yOffset: 0,
                      yVelocity: -12 * Math.min(strengthFactor, 1.5),
                      targetY: -22 * Math.min(strengthFactor, 1.5),
                    });
                  } else {
                    // Always blend colors when waves intersect
                    if (neighborCube.color) {
                      const newColorMatch = waveColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                      const existingColorMatch = neighborCube.color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);

                      if (newColorMatch && existingColorMatch) {
                        // Blend the colors
                        const blendFactor = 0.5;
                        const r = Math.floor(Number.parseInt(existingColorMatch[1]) * (1 - blendFactor) + Number.parseInt(newColorMatch[1]) * blendFactor);
                        const g = Math.floor(Number.parseInt(existingColorMatch[2]) * (1 - blendFactor) + Number.parseInt(newColorMatch[2]) * blendFactor);
                        const b = Math.floor(Number.parseInt(existingColorMatch[3]) * (1 - blendFactor) + Number.parseInt(newColorMatch[3]) * blendFactor);
                        neighborCube.color = `rgb(${r}, ${g}, ${b})`;
                      }
                    } else {
                      // If cube has no color, give it the wave color
                      neighborCube.color = waveColor;
                    }

                    // Add energy to the wave with velocity-based strength
                    const clampedStrength = Math.min(strengthFactor, 1.5);
                    neighborCube.fadeProgress = Math.min(1, neighborCube.fadeProgress + 0.3 * clampedStrength);
                    neighborCube.yVelocity += -10 * clampedStrength;
                    neighborCube.targetY = Math.min(neighborCube.targetY, -22 * clampedStrength);
                  }
                }, delayFactor * 50);
              }
            }
          }
        }
      }
    } else {
      currentHoverRef.current = null;
      lastTriggeredCubeRef.current = null;
      lastHoverPositionRef.current = null;
    }
  };

    const animate = () => {
      // Calculate delta time in seconds
      const currentTime = performance.now();
      const deltaTime = (currentTime - lastFrameTimeRef.current) / 1000; // Convert to seconds
      lastFrameTimeRef.current = currentTime;

      // Cap delta time to prevent large jumps (e.g., when tab is hidden)
      const dt = Math.min(deltaTime, 0.1);

      ctx.clearRect(0, 0, dimensions.width, dimensions.height);

      // Calculate grid offset to properly center the isometric grid
      const gridHeight = (ROWS + COLS) * (CUBE_HEIGHT / 4);
      const offsetX = dimensions.width / 2;
      const offsetY = dimensions.height / 2 - gridHeight / 2;

      // Draw all cubes
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          // Calculate isometric position
          const x = (col - row) * (CUBE_WIDTH / 2) + offsetX;
          let y = (col + row) * (CUBE_HEIGHT / 4) + offsetY;

          const key = `${row}-${col}`;
          const cube = cubesRef.current.get(key);

          let colorToUse = null;

          // Check if this cube should have color
          if (cube && cube.color) {
            const isCurrentlyHovered = currentHoverRef.current === key;

            if (isCurrentlyHovered) {
              // Keep hovered cube at full brightness
              cube.fadeProgress = 1;
              cube.targetY = -30;
            } else {
              // Fade out animation for non-hovered cubes (framerate independent)
              cube.fadeProgress -= 1 * dt; // 1.5 units per second
              cube.targetY = 0;
            }

            // Spring physics for elastic animation (framerate independent)
            const springStrength = 6.0; // Spring constant (adjusted for dt)
            const damping = isCurrentlyHovered ? 0.65 : 0.85; // Sharper damping on hovered cube for more bounce

            // Calculate spring force
            const displacement = cube.targetY - cube.yOffset;
            const springForce = displacement * springStrength * dt;

            // Apply spring force to velocity
            cube.yVelocity += springForce;

            // Apply damping to velocity (exponential decay for frame independence)
            cube.yVelocity *= damping ** (dt * 60); // Normalize for 60fps baseline

            // Update position based on velocity (framerate independent)
            cube.yOffset += cube.yVelocity * dt * 60;

            // Clamp position to prevent going too far
            if (!isCurrentlyHovered) {
              cube.yOffset = Math.min(0, cube.yOffset);
            }

            if (cube.fadeProgress <= 0) {
              cubesRef.current.delete(key);
            } else {
              // Lerp between base gray-900 and highlight color
              const baseColor: [number, number, number] = [16, 24, 40];
              const rgbMatch = cube.color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
              if (rgbMatch) {
                const highlightColor: [number, number, number] = [
                  Number.parseInt(rgbMatch[1]),
                  Number.parseInt(rgbMatch[2]),
                  Number.parseInt(rgbMatch[3]),
                ];
                const lerpedColor = lerpColor(baseColor, highlightColor, cube.fadeProgress);
                colorToUse = `rgb(${lerpedColor[0]}, ${lerpedColor[1]}, ${lerpedColor[2]})`;
              } else {
                colorToUse = cube.color;
              }

              // Apply vertical offset for pop animation
              y += cube.yOffset;
            }
          }

          // Draw the cube once with the appropriate color
          drawCube(x, y, colorToUse);
        }
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    const handleMouseLeave = () => {
      currentHoverRef.current = null;
      lastTriggeredCubeRef.current = null;
      lastHoverPositionRef.current = null;
      velocityRef.current = { speed: 0, dirX: 0, dirY: 0 };
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    // Reset frame time for this animation loop
    lastFrameTimeRef.current = performance.now();
    animate();

    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [dimensions]);

  return (
    <div
      className={cn(
        'absolute inset-0 w-full h-full z-0 overflow-visible',
        className,
      )}
      style={{
        isolation: 'isolate',
        contain: 'layout style paint',
      }}
      {...rest}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{
          imageRendering: 'crisp-edges',
          transform: 'translate3d(0, 0, 0)',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
          filter: 'blur(0px)', // Forces layer creation
          willChange: 'transform',
        }}
      />
    </div>
  );
};
