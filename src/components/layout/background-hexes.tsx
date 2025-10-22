import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface BoxesProps {
  className?: string;
}

interface Box {
  color: string | null;
  fadeProgress: number;
}

// Brackeys brand colors for the sequential gradient
const BRACKEYS_COLORS = [
  { r: 255, g: 169, b: 73 },   // brackeys-yellow: #ffa949
  { r: 210, g: 53, b: 107 },   // brackeys-fuscia: #d2356b
  { r: 88, g: 101, b: 242 },   // brackeys-purple-500: #5865f2
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
  const lastHoverPositionRef = useRef<{ row: number; col: number; time: number } | null>(null);
  const velocityRef = useRef<{ speed: number; dirX: number; dirY: number }>({ speed: 0, dirX: 0, dirY: 0 });
  const lastUpdateTimeRef = useRef<number>(performance.now());

  const rows = 60; // Reduced from 80 for better performance
  const cols = 60; // Reduced from 80 for better performance
  const hexRadius = 25; // Slightly increased to maintain visual density
  const hexWidth = hexRadius * 2;
  const hexHeight = hexRadius * Math.sqrt(3);

  // Function to get next color by interpolating through the gradient
  const getNextColor = (): string => {
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
      boxesRef.current = Array(totalBoxes).fill(null).map(() => ({
        color: null,
        fadeProgress: 0,
      }));
    }

    // Helper function to draw a hexagon
    const drawHexagon = (cx: number, cy: number, radius: number, fill?: string, stroke = true) => {
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

    // Get hexagonal neighbors accounting for odd/even row offsets
    const getHexNeighbors = (row: number, col: number): Array<{ row: number; col: number }> => {
      const isEvenRow = row % 2 === 0;
      const offsets = isEvenRow
        ? [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]]
        : [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]];

      return offsets
        .map(([dr, dc]) => ({ row: row + dr, col: col + dc }))
        .filter(pos => pos.row >= 0 && pos.row < rows && pos.col >= 0 && pos.col < cols);
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Apply velocity decay for smooth falloff when mouse stops
      const currentTime = performance.now();
      const deltaTime = (currentTime - lastUpdateTimeRef.current) / 1000; // in seconds
      lastUpdateTimeRef.current = currentTime;

      // Exponential decay with long, smooth falloff for momentum carry
      const decayRate = 0.5; // 50% remains per second = very slow, smooth falloff
      velocityRef.current.speed *= decayRate ** deltaTime;

      // Stop completely when speed is negligible (lower threshold for smoother tail)
      if (velocityRef.current.speed < 0.001) {
        velocityRef.current.speed = 0;
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
          const xOffset = (row % 2) * (hexWidth * 0.87) / 2;
          const x = col * hexWidth * 0.87 + xOffset;
          const y = row * hexHeight * 0.87;

          // Draw fill if box has color
          if (box.color && box.fadeProgress > 0) {
            ctx.globalAlpha = box.fadeProgress;
            drawHexagon(x, y, hexRadius, box.color, true);
            ctx.globalAlpha = 1;

            // Keep currently hovered cell highlighted, fade others
            if (index !== hoveredIndexRef.current) {
              box.fadeProgress = Math.max(0, box.fadeProgress - 0.015);
            }
          } else {
            // Draw just the outline
            drawHexagon(x, y, hexRadius, undefined, true);
          }
        }
      }

      ctx.restore();
      animationFrameRef.current = requestAnimationFrame(draw);
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
          const xOffset = (row % 2) * (hexWidth * 0.87) / 2;
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

            // Only trigger waves and get new color when moving to a different cell
            if (lastTriggeredIndexRef.current !== index) {
              lastTriggeredIndexRef.current = index;

              // Calculate velocity and direction
              const currentTime = performance.now();
              if (lastHoverPositionRef.current) {
                const deltaRow = row - lastHoverPositionRef.current.row;
                const deltaCol = col - lastHoverPositionRef.current.col;
                const distance = Math.sqrt(deltaRow * deltaRow + deltaCol * deltaCol);
                const deltaTime = currentTime - lastHoverPositionRef.current.time;

                // Calculate velocity (cells per millisecond, scaled up)
                const rawSpeed = deltaTime > 0 ? (distance / deltaTime) * 100 : 0;

                // Blend new velocity with existing (momentum preservation)
                // This creates smoother acceleration/deceleration
                const blendFactor = 0.7; // 70% new velocity, 30% old (preserves momentum)
                velocityRef.current.speed = Math.min(
                  velocityRef.current.speed * (1 - blendFactor) + rawSpeed * blendFactor,
                  15 // Cap at 15
                );

                // Calculate normalized direction vector
                if (distance > 0) {
                  velocityRef.current.dirX = deltaCol / distance;
                  velocityRef.current.dirY = deltaRow / distance;
                }
              } else {
                // First movement
                velocityRef.current.speed = 1;
                velocityRef.current.dirX = 0;
                velocityRef.current.dirY = 0;
              }

              lastHoverPositionRef.current = { row, col, time: currentTime };

              // Get next color in sequence
              const waveColor = getNextColor();
              boxesRef.current[index] = {
                color: waveColor,
                fadeProgress: 1,
              };

              // Create wave effect with velocity-based radius
              // Start at 0 (no wave) and ramp up slowly with speed
              const baseRadius = 0;
              const velocityBonus = Math.min(velocityRef.current.speed * 0.3, 8); // Slower ramp (0.3 instead of 0.5)
              const waveRadius = baseRadius + velocityBonus;

              // Propagate to neighbors in expanding circles
              const visited = new Set<string>();
              const queue: Array<{ row: number; col: number; distance: number }> = [{ row, col, distance: 0 }];
              visited.add(`${row}-${col}`);

              while (queue.length > 0) {
                const current = queue.shift()!;
                if (current.distance >= waveRadius) continue;

                const neighbors = getHexNeighbors(current.row, current.col);

                for (const neighbor of neighbors) {
                  const key = `${neighbor.row}-${neighbor.col}`;
                  if (visited.has(key)) continue;
                  visited.add(key);

                  const dr = neighbor.row - row;
                  const dc = neighbor.col - col;
                  const distance = Math.sqrt(dr * dr + dc * dc);

                  if (distance <= waveRadius && distance > 0) {
                    // Calculate directional strength
                    let directionalMultiplier = 1;
                    if (velocityRef.current.speed > 0.5) {
                      const neighborDirX = dc / distance;
                      const neighborDirY = dr / distance;
                      const alignment = neighborDirX * velocityRef.current.dirX +
                                       neighborDirY * velocityRef.current.dirY;
                      directionalMultiplier = 1 + Math.max(0, alignment) * (velocityRef.current.speed / 10);
                    }

                    const delayFactor = distance / waveRadius;
                    const baseFalloff = 1 - (distance / waveRadius) * 0.3;
                    const strengthFactor = baseFalloff * directionalMultiplier;

                    setTimeout(() => {
                      const neighborIndex = neighbor.row * cols + neighbor.col;
                      const neighborBox = boxesRef.current[neighborIndex];

                      if (!neighborBox.color) {
                        // New cell - give it wave color with strength-based fade
                        boxesRef.current[neighborIndex] = {
                          color: waveColor,
                          fadeProgress: Math.min(1, 0.8 * strengthFactor),
                        };
                      } else {
                        // Existing cell - blend colors
                        const newColorMatch = waveColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
                        const existingColorMatch = neighborBox.color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);

                        if (newColorMatch && existingColorMatch) {
                          const blendFactor = 0.5;
                          const r = Math.floor(Number.parseInt(existingColorMatch[1]) * (1 - blendFactor) +
                                             Number.parseInt(newColorMatch[1]) * blendFactor);
                          const g = Math.floor(Number.parseInt(existingColorMatch[2]) * (1 - blendFactor) +
                                             Number.parseInt(newColorMatch[2]) * blendFactor);
                          const b = Math.floor(Number.parseInt(existingColorMatch[3]) * (1 - blendFactor) +
                                             Number.parseInt(newColorMatch[3]) * blendFactor);
                          neighborBox.color = `rgb(${r}, ${g}, ${b})`;
                        }

                        // Add energy to fade progress
                        const clampedStrength = Math.min(strengthFactor, 1.5);
                        neighborBox.fadeProgress = Math.min(1, neighborBox.fadeProgress + 0.3 * clampedStrength);
                      }
                    }, delayFactor * 50);

                    // Add to queue for further expansion
                    queue.push({ row: neighbor.row, col: neighbor.col, distance: distance });
                  }
                }
              }
            } else {
              // Same cell, just keep it at full brightness
              const box = boxesRef.current[index];
              if (box) {
                box.fadeProgress = 1;
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
      // Don't reset velocity to 0 immediately - let it decay naturally for momentum
      // velocityRef.current = { speed: 0, dirX: 0, dirY: 0 };
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    // Reset time tracker for this animation loop
    lastUpdateTimeRef.current = performance.now();
    draw();

    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [dimensions, rows, cols, hexRadius, hexWidth, hexHeight]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'absolute inset-0 w-full h-full z-0',
        className,
      )}
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
