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

  const rows = 50;
  const cols = 50;
  const boxWidth = 48;
  const boxHeight = 32;

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: we don't want to re-render the canvas on every render
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
        }));
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Save context and apply transform for skewed grid
      ctx.save();

      // Calculate grid dimensions
      const gridWidth = rows * boxWidth;
      const gridHeight = cols * boxHeight;

      // Calculate scale to fit the canvas while maintaining aspect ratio
      const scaleX = (canvas.width * 0.8) / gridWidth;
      const scaleY = (canvas.height * 0.8) / gridHeight;
      const scale = Math.min(scaleX, scaleY);

      // Center the grid
      const offsetX = canvas.width / 2;
      const offsetY = canvas.height / 2;

      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);
      ctx.transform(1, 0.24, -0.83, 1, 0, 0); // Approximation of skewX(-48deg) skewY(14deg)

      // Translate to center the grid content
      ctx.translate(-gridWidth / 2, -gridHeight / 2);

      // Draw all boxes
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          const index = i * cols + j;
          const box = boxesRef.current[index];
          const x = i * boxWidth;
          const y = j * boxHeight;

          // Draw fill if box has color
          if (box.color && box.fadeProgress > 0) {
            ctx.fillStyle = box.color;
            ctx.globalAlpha = box.fadeProgress;
            ctx.fillRect(x, y, boxWidth, boxHeight);
            ctx.globalAlpha = 1;

            // Update fade progress
            box.fadeProgress = Math.max(0, box.fadeProgress - 0.015);
          }

          // Draw borders
          ctx.strokeStyle = 'rgba(71, 85, 105, 0.5)';
          ctx.lineWidth = 1;
          ctx.strokeRect(x, y, boxWidth, boxHeight);

          // Draw cross pattern at alternating intersections
          if (j % 2 === 0 && i % 2 === 0) {
            ctx.strokeStyle = 'rgba(71, 85, 105, 0.5)';
            ctx.lineWidth = 1;
            const intersectionX = x;
            const intersectionY = y;
            const size = 12;

            ctx.beginPath();
            ctx.moveTo(intersectionX - size, intersectionY);
            ctx.lineTo(intersectionX + size, intersectionY);
            ctx.moveTo(intersectionX, intersectionY - size);
            ctx.lineTo(intersectionX, intersectionY + size);
            ctx.stroke();
          }
        }
      }

      ctx.restore();
      animationFrameRef.current = requestAnimationFrame(draw);
    };

    // Mouse event handler
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Calculate same values as in draw()
      const gridWidth = rows * boxWidth;
      const gridHeight = cols * boxHeight;
      const scaleX = (canvas.width * 0.8) / gridWidth;
      const scaleY = (canvas.height * 0.8) / gridHeight;
      const scale = Math.min(scaleX, scaleY);
      const offsetX = canvas.width / 2;
      const offsetY = canvas.height / 2;

      // Inverse transform to get grid coordinates
      // 1. Undo translation to center
      const tx = mouseX - offsetX;
      const ty = mouseY - offsetY;

      // 2. Undo scale
      const scaled_tx = tx / scale;
      const scaled_ty = ty / scale;

      // 3. Inverse of transform matrix (1, 0.24, -0.83, 1, 0, 0)
      const det = 1 * 1 - 0.24 * -0.83;
      const inv_a = 1 / det;
      const inv_b = -0.24 / det;
      const inv_c = 0.83 / det;
      const inv_d = 1 / det;

      const unskewed_x = inv_a * scaled_tx + inv_c * scaled_ty;
      const unskewed_y = inv_b * scaled_tx + inv_d * scaled_ty;

      // 4. Undo grid centering translation
      const gridX = unskewed_x + gridWidth / 2;
      const gridY = unskewed_y + gridHeight / 2;

      // Find which box
      const boxI = Math.floor(gridX / boxWidth);
      const boxJ = Math.floor(gridY / boxHeight);
      const index = boxI * cols + boxJ;

      if (
        index >= 0 &&
        index < boxesRef.current.length &&
        boxI >= 0 &&
        boxI < rows &&
        boxJ >= 0 &&
        boxJ < cols
      ) {
        const box = boxesRef.current[index];

        if (!box.color || box.fadeProgress < 0.5) {
          const color = getNextColor();
          boxesRef.current[index] = {
            color: color,
            fadeProgress: 1,
          };
        }
      }
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    draw();

    return () => {
      canvas.removeEventListener('mousemove', handleMouseMove);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [dimensions]);

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
