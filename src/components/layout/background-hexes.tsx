import { RefObject, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface BoxesProps {
  className?: string;
}

interface Box {
  color: string | null;
  fadeProgress: number;
  waveIntensity: number; // Current wave displacement at this hex
}

interface Wave {
  originRow: number;
  originCol: number;
  startTime: number;
  speed: number; // hexes per second
  amplitude: number; // wave strength
  frequency: number; // affects wave pattern
  color: string; // wave color
  dirX: number; // velocity direction X component
  dirY: number; // velocity direction Y component
  isDirectional: boolean; // true for movement waves, false for click waves
  id: number;
}

// Brackeys brand colors for the sequential gradient
const BRACKEYS_COLORS = [
  { r: 255, g: 169, b: 73 }, // brackeys-yellow: #ffa949
  { r: 210, g: 53, b: 107 }, // brackeys-fuscia: #d2356b
  { r: 88, g: 101, b: 242 }, // brackeys-purple-500: #5865f2
];

export const Boxes = ({ className, ...rest }: BoxesProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const boxesRef = useRef<Box[]>([]);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const colorPositionRef = useRef<number>(0);
  const hoveredIndexRef = useRef<number | null>(null);
  const lastTriggeredIndexRef = useRef<number | null>(null);
  const lastHoverPositionRef = useRef<{
    row: number;
    col: number;
    time: number;
  } | null>(null);
  const velocityRef = useRef<{ speed: number; dirX: number; dirY: number }>({
    speed: 0,
    dirX: 0,
    dirY: 0,
  });
  const lastUpdateTimeRef = useRef<number>(performance.now());
  const activeWavesRef = useRef<Wave[]>([]);
  const waveIdCounterRef = useRef<number>(0);
  const lastWakeTimeRef = useRef<number>(0);

  const rows = 60; // Reduced from 80 for better performance
  const cols = 60; // Reduced from 80 for better performance
  const hexRadius = 25; // Slightly increased to maintain visual density
  const hexWidth = hexRadius * 2;
  const hexHeight = hexRadius * Math.sqrt(3);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight,
        });
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

    // Set canvas size to match container
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;

    // Initialize boxes only once
    if (boxesRef.current.length === 0) {
      const totalBoxes = rows * cols;
      boxesRef.current = Array(totalBoxes)
        .fill(null)
        .map(() => ({
          color: null,
          fadeProgress: 0,
          waveIntensity: 0,
        }));
    }

    // Helper function to draw a hexagon
    const drawHexagon = (
      cx: number,
      cy: number,
      radius: number,
      fill?: string,
      stroke = true,
    ) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 2; // Start from top
        const x = cx + radius * Math.cos(angle);
        const y = cy + radius * Math.sin(angle);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();

      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }

      if (stroke) {
        ctx.strokeStyle = 'rgba(71, 85, 105, 0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const currentTime = performance.now();
      lastUpdateTimeRef.current = currentTime;

      // Remove waves that have propagated beyond the grid (lifetime ~3 seconds)
      const maxWaveLifetime = 3000; // milliseconds
      activeWavesRef.current = activeWavesRef.current.filter(
        (wave) => currentTime - wave.startTime < maxWaveLifetime,
      );

      // Calculate wave interference at each hex
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const index = row * cols + col;
          const box = boxesRef.current[index];

          let totalWaveIntensity = 0;
          let strongestWaveColor: string | null = null;
          let maxAmplitude = 0;

          // Sum up contributions from all active waves
          for (const wave of activeWavesRef.current) {
            const elapsed = (currentTime - wave.startTime) / 1000; // seconds
            const dr = row - wave.originRow;
            const dc = col - wave.originCol;
            const distance = Math.sqrt(dr * dr + dc * dc);

            // Skip origin hex to avoid division by zero
            if (distance === 0) continue;

            // Calculate wave front position
            const waveFrontDistance = elapsed * wave.speed;

            // Wave equation: uses a Gaussian-modulated sine wave
            // This creates a wave packet that expands outward
            const distanceFromWaveFront = distance - waveFrontDistance;

            // Wave width (spatial extent of the wave packet) - sharper than before
            const waveWidth = 1.5;

            // Amplitude envelope (Gaussian that travels with the wave front)
            const envelopeStrength = Math.exp(
              -(distanceFromWaveFront ** 2) / (2 * waveWidth ** 2),
            );

            // Oscillating wave component
            const phaseOffset = distance * wave.frequency;
            const oscillation = Math.sin(
              phaseOffset - waveFrontDistance * wave.frequency,
            );

            // Sharper damping over time and distance
            const timeDamping = Math.exp(-elapsed * 1.5);
            const distanceDamping = 1 / (1 + distance * 0.25);

            // Calculate base wave intensity
            let waveContribution =
              wave.amplitude *
              envelopeStrength *
              oscillation *
              timeDamping *
              distanceDamping;

            // Apply directional focusing for movement-based waves
            if (wave.isDirectional) {
              // Calculate alignment between wave direction and hex position
              const alignment = (dc * wave.dirX + dr * wave.dirY) / distance;

              // Only propagate forward in a cone (skip hexes behind or too far to sides)
              if (alignment < 0.2) continue;

              // Strong directional focusing (cubic falloff from center of cone)
              const directionalStrength = Math.pow(alignment, 3);
              waveContribution *= directionalStrength;
            }

            totalWaveIntensity += waveContribution;

            // Track the strongest wave's color
            if (Math.abs(waveContribution) > maxAmplitude) {
              maxAmplitude = Math.abs(waveContribution);
              strongestWaveColor = wave.color;
            }
          }

          // Update wave intensity (smooth interpolation)
          const intensityBlend = 0.3;
          box.waveIntensity =
            box.waveIntensity * (1 - intensityBlend) +
            totalWaveIntensity * intensityBlend;

          // Update color and fade based on wave intensity
          const absoluteIntensity = Math.abs(box.waveIntensity);
          if (absoluteIntensity > 0.1) {
            if (!box.color && strongestWaveColor) {
              box.color = strongestWaveColor;
            }
            box.fadeProgress = Math.min(1, absoluteIntensity);
          } else {
            // Fade out when no significant wave activity
            box.fadeProgress = Math.max(0, box.fadeProgress - 0.02);
          }
        }
      }

      // Save context and apply transform for skewed grid
      ctx.save();

      // Calculate grid dimensions for hexagonal packing
      const gridWidth = cols * hexWidth * 0.87;
      const gridHeight = rows * hexHeight * 0.87;

      // Calculate scale to fit the canvas while maintaining aspect ratio
      // Increased multiplier to 1.5 to ensure grid fills the space
      const scaleX = (canvas.width * 3) / gridWidth;
      const scaleY = (canvas.height * 3) / gridHeight;
      const scale = Math.min(scaleX, scaleY);

      // Center the grid
      const offsetX = canvas.width / 2;
      const offsetY = canvas.height / 2;

      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);
      ctx.transform(1, 0.24, -0.83, 1, 0, 0); // Approximation of skewX(-48deg) skewY(14deg)

      // Translate to center the grid content
      ctx.translate(-gridWidth / 2, -gridHeight / 2);

      // Draw all hexagons
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const index = row * cols + col;
          const box = boxesRef.current[index];

          // Hexagonal grid positioning (offset every other row)
          const xOffset = ((row % 2) * (hexWidth * 0.87)) / 2;
          const x = col * hexWidth * 0.87 + xOffset;
          const y = row * hexHeight * 0.87;

          // Draw fill if box has color and wave intensity
          if (box.color && box.fadeProgress > 0) {
            ctx.globalAlpha = box.fadeProgress;
            drawHexagon(x, y, hexRadius, box.color, true);
            ctx.globalAlpha = 1;
          } else {
            // Draw just the outline
            drawHexagon(x, y, hexRadius, undefined, true);
          }
        }
      }

      ctx.restore();
      animationFrameRef.current = requestAnimationFrame(draw);
    };

    // Function to create a wave at a given position
    const createWave = (
      row: number,
      col: number,
      amplitude: number,
      speed: number,
      frequency: number,
      color: string,
      dirX: number,
      dirY: number,
      isDirectional: boolean,
    ) => {
      waveIdCounterRef.current += 1;
      const wave: Wave = {
        originRow: row,
        originCol: col,
        startTime: performance.now(),
        speed,
        amplitude,
        frequency,
        color,
        dirX,
        dirY,
        isDirectional,
        id: waveIdCounterRef.current,
      };
      activeWavesRef.current.push(wave);
    };

    // Mouse event handler - using point-in-path detection
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Calculate same transform values as in draw()
      const gridWidth = cols * hexWidth * 0.87;
      const gridHeight = rows * hexHeight * 0.87;
      const scaleX = (canvas.width * 3) / gridWidth;
      const scaleY = (canvas.height * 3) / gridHeight;
      const scale = Math.min(scaleX, scaleY);
      const offsetX = canvas.width / 2;
      const offsetY = canvas.height / 2;

      // Apply the same transforms to check point collision
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);
      ctx.transform(1, 0.24, -0.83, 1, 0, 0);
      ctx.translate(-gridWidth / 2, -gridHeight / 2);

      // Reset hovered index
      hoveredIndexRef.current = null;

      // Check each hexagon to see if mouse is inside it
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const index = row * cols + col;
          const xOffset = ((row % 2) * (hexWidth * 0.87)) / 2;
          const x = col * hexWidth * 0.87 + xOffset;
          const y = row * hexHeight * 0.87;

          // Create hexagon path
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i - Math.PI / 2;
            const hx = x + hexRadius * Math.cos(angle);
            const hy = y + hexRadius * Math.sin(angle);
            if (i === 0) {
              ctx.moveTo(hx, hy);
            } else {
              ctx.lineTo(hx, hy);
            }
          }
          ctx.closePath();

          // Check if mouse is in this hexagon
          if (ctx.isPointInPath(mouseX, mouseY)) {
            hoveredIndexRef.current = index;

            // Calculate velocity and create wake waves
            const currentTime = performance.now();

            if (lastTriggeredIndexRef.current !== index) {
              lastTriggeredIndexRef.current = index;

              // Calculate velocity
              if (lastHoverPositionRef.current) {
                const deltaRow = row - lastHoverPositionRef.current.row;
                const deltaCol = col - lastHoverPositionRef.current.col;
                const distance = Math.sqrt(
                  deltaRow * deltaRow + deltaCol * deltaCol,
                );
                const deltaTime =
                  currentTime - lastHoverPositionRef.current.time;

                // Calculate velocity (cells per second)
                const rawSpeed =
                  deltaTime > 0 ? distance / (deltaTime / 1000) : 0;

                // Smooth velocity blending
                const blendFactor = 0.7;
                velocityRef.current.speed = Math.min(
                  velocityRef.current.speed * (1 - blendFactor) +
                    rawSpeed * blendFactor,
                  30, // Increased cap for more dramatic waves
                );

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

              // Get color for this wave sequence
              const waveColor = getNextColor(colorPositionRef);

              // Create primary wave at current position
              // Wave amplitude based on velocity
              const primaryAmplitude = Math.min(
                0.5 + velocityRef.current.speed * 0.05,
                1.5,
              );
              const primarySpeed = 8 + velocityRef.current.speed * 0.3; // hexes per second
              const primaryFrequency = 0.8;

              // All movement creates directional waves
              createWave(
                row,
                col,
                primaryAmplitude,
                primarySpeed,
                primaryFrequency,
                waveColor,
                velocityRef.current.dirX,
                velocityRef.current.dirY,
                true, // isDirectional
              );

              // Create wake trail waves when moving fast enough
              const wakeThreshold = 3; // minimum speed for wake
              if (
                velocityRef.current.speed > wakeThreshold &&
                lastHoverPositionRef.current
              ) {
                const timeSinceLastWake = currentTime - lastWakeTimeRef.current;
                const wakeInterval = 80; // ms between wake waves

                if (timeSinceLastWake >= wakeInterval) {
                  lastWakeTimeRef.current = currentTime;

                  // Create secondary waves behind the motion
                  // These are offset perpendicular to the direction of motion
                  const perpDirX = -velocityRef.current.dirY;
                  const perpDirY = velocityRef.current.dirX;

                  // Create V-shaped wake pattern
                  const wakeOffsets = [
                    { angle: 0.7, dist: 1.5 }, // Left wake
                    { angle: -0.7, dist: 1.5 }, // Right wake
                  ];

                  for (const offset of wakeOffsets) {
                    // Rotate perpendicular direction by wake angle
                    const wakeAngle = offset.angle;
                    const wakeDirX =
                      perpDirX * Math.cos(wakeAngle) -
                      perpDirY * Math.sin(wakeAngle);
                    const wakeDirY =
                      perpDirX * Math.sin(wakeAngle) +
                      perpDirY * Math.cos(wakeAngle);

                    const wakeRow = Math.round(
                      row -
                        velocityRef.current.dirY * offset.dist +
                        wakeDirY * offset.dist,
                    );
                    const wakeCol = Math.round(
                      col -
                        velocityRef.current.dirX * offset.dist +
                        wakeDirX * offset.dist,
                    );

                    // Ensure wake position is within grid bounds
                    if (
                      wakeRow >= 0 &&
                      wakeRow < rows &&
                      wakeCol >= 0 &&
                      wakeCol < cols
                    ) {
                      const wakeAmplitude = primaryAmplitude * 0.6; // Wake is weaker than main wave
                      const wakeSpeed = primarySpeed * 0.8;
                      const wakeFrequency = 1.2; // Higher frequency for wake

                      // Wake waves are directional with their own direction vectors
                      createWave(
                        wakeRow,
                        wakeCol,
                        wakeAmplitude,
                        wakeSpeed,
                        wakeFrequency,
                        waveColor,
                        wakeDirX,
                        wakeDirY,
                        true, // isDirectional
                      );
                    }
                  }
                }
              }
            }

            break; // Found the hexagon, no need to check more
          }
        }
      }

      ctx.restore();
    };

    const handleMouseLeave = () => {
      hoveredIndexRef.current = null;
      lastTriggeredIndexRef.current = null;
      lastHoverPositionRef.current = null;
      velocityRef.current = { speed: 0, dirX: 0, dirY: 0 };
      // Waves will naturally dissipate based on their lifetime
    };

    // Click handler for creating radial waves
    const handleMouseClick = (e: MouseEvent) => {
      // Only create radial wave if not currently moving
      if (velocityRef.current.speed > 1) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Calculate same transform values as in draw()
      const gridWidth = cols * hexWidth * 0.87;
      const gridHeight = rows * hexHeight * 0.87;
      const scaleX = (canvas.width * 3) / gridWidth;
      const scaleY = (canvas.height * 3) / gridHeight;
      const scale = Math.min(scaleX, scaleY);
      const offsetX = canvas.width / 2;
      const offsetY = canvas.height / 2;

      // Apply the same transforms to check point collision
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);
      ctx.transform(1, 0.24, -0.83, 1, 0, 0);
      ctx.translate(-gridWidth / 2, -gridHeight / 2);

      // Check each hexagon to see if mouse is inside it
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const xOffset = ((row % 2) * (hexWidth * 0.87)) / 2;
          const x = col * hexWidth * 0.87 + xOffset;
          const y = row * hexHeight * 0.87;

          // Create hexagon path
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i - Math.PI / 2;
            const hx = x + hexRadius * Math.cos(angle);
            const hy = y + hexRadius * Math.sin(angle);
            if (i === 0) {
              ctx.moveTo(hx, hy);
            } else {
              ctx.lineTo(hx, hy);
            }
          }
          ctx.closePath();

          // Check if mouse is in this hexagon
          if (ctx.isPointInPath(mouseX, mouseY)) {
            // Create a radial wave at the clicked position
            const clickColor = getNextColor(colorPositionRef);
            const clickAmplitude = 1.2;
            const clickSpeed = 10;
            const clickFrequency = 0.8;

            createWave(
              row,
              col,
              clickAmplitude,
              clickSpeed,
              clickFrequency,
              clickColor,
              0, // dirX unused for radial
              0, // dirY unused for radial
              false, // isDirectional - radial wave
            );

            ctx.restore();
            return;
          }
        }
      }

      ctx.restore();
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);
    canvas.addEventListener('click', handleMouseClick);

    // Reset time tracker for this animation loop
    lastUpdateTimeRef.current = performance.now();
    draw();

    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      canvas.removeEventListener('click', handleMouseClick);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [dimensions, hexWidth, hexHeight]);

  return (
    <div
      ref={containerRef}
      className={cn('absolute inset-0 w-full h-full z-0', className)}
      {...rest}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{
          imageRendering: 'crisp-edges',
        }}
      />
    </div>
  );
};

/**
 * Get the next color by interpolating through the gradient
 * @param colorPositionRef - The reference to the color position
 * @returns The next color
 */
const getNextColor = (colorPositionRef: RefObject<number>) => {
  colorPositionRef.current = (colorPositionRef.current + 0.05) % 1;
  const scaledPosition = colorPositionRef.current * BRACKEYS_COLORS.length;
  const lowerIndex = Math.floor(scaledPosition);
  const upperIndex = (lowerIndex + 1) % BRACKEYS_COLORS.length;
  const t = scaledPosition - lowerIndex;

  const lowerColor = BRACKEYS_COLORS[lowerIndex];
  const upperColor = BRACKEYS_COLORS[upperIndex];

  const r = Math.floor(lowerColor.r + (upperColor.r - lowerColor.r) * t);
  const g = Math.floor(lowerColor.g + (upperColor.g - lowerColor.g) * t);
  const b = Math.floor(lowerColor.b + (upperColor.b - lowerColor.b) * t);

  return `rgb(${r}, ${g}, ${b})`;
};
