import { AnimatePresence, motion, useMotionValue, useSpring } from 'framer-motion';
import * as React from 'react';
import { useCursorState } from '@/lib/hooks/use-cursor';
import { cn } from '@/lib/utils';

interface CursorProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export function Cursor({ className, ...props }: CursorProps) {
  const cursorState = useCursorState();
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const [isPressed, setIsPressed] = React.useState(false);

  const springConfig = { damping: 20, stiffness: 1500, mass: 0.05 };
  
  const springX = useSpring(mouseX, springConfig);
  const springY = useSpring(mouseY, springConfig);

  const width = useMotionValue(8);
  const height = useMotionValue(8);
  const borderRadius = useMotionValue(9999);

  const springWidth = useSpring(width, springConfig);
  const springHeight = useSpring(height, springConfig);
  const springBorderRadius = useSpring(borderRadius, springConfig);

  React.useEffect(() => {
    const handleMouseDown = () => setIsPressed(true);
    const handleMouseUp = () => setIsPressed(false);
    
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (cursorState.type === 'magnetic' && cursorState.targetRect) {
        const { left, top, width: targetWidth, height: targetHeight } = cursorState.targetRect;
        
        const centerX = left + targetWidth / 2;
        const centerY = top + targetHeight / 2;

        const offsetX = (e.clientX - centerX) * 0.1;
        const offsetY = (e.clientY - centerY) * 0.1;

        springX.set(centerX + offsetX);
        springY.set(centerY + offsetY);

        width.set(targetWidth + 12);
        height.set(targetHeight + 8);
        borderRadius.set(0);
      } else {

        mouseX.set(e.clientX);
        mouseY.set(e.clientY);
        
        if (cursorState.type === 'pointer') {
          width.set(48);
          height.set(48);
          borderRadius.set(9999);
        } else if (cursorState.type === 'text') {
          width.set(2);
          height.set(24);
          borderRadius.set(2);
        } else {
          width.set(12);
          height.set(12);
          borderRadius.set(9999);
        }
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [mouseX, mouseY, width, height, borderRadius, cursorState, springX, springY]);

  if (cursorState.type === 'hidden') return null;

  return (
    <motion.div
      style={{
        x: springX,
        y: springY,
        width: springWidth,
        height: springHeight,
        borderRadius: springBorderRadius,
        translateX: '-50%',
        translateY: '-50%',
      }}
      className={cn(
        'pointer-events-none fixed top-0 left-0 z-[9999] flex items-center justify-center transition-colors duration-200',
        cursorState.type === 'default' && 'backdrop-invert',
        cursorState.type === 'pointer' && 'bg-primary/20 backdrop-blur-sm border border-primary/50',
        cursorState.type === 'text' && 'bg-primary',
        cursorState.type === 'magnetic' && 'bg-muted',
        className
      )}
      {...props}
    >
      {cursorState.type === 'magnetic' && (
        <motion.div 
          className="absolute inset-0 pointer-events-none"
          animate={{
            scale: !isPressed ? [1, 0.95, 1] : [1, 1, 1],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        >
          <motion.div 
            animate={{ scaleY: isPressed ? -1 : 1, scaleX: isPressed ? -1 : 1 }}
            className={cn("absolute top-0 left-0 w-3 h-3 border-t-4 border-l-4 border-foreground transition-all duration-50", isPressed && '-top-1.5 -left-1.5')} 
          />
          <motion.div 
            animate={{ scaleY: isPressed ? -1 : 1, scaleX: isPressed ? -1 : 1 }}
            className={cn("absolute top-0 right-0 w-3 h-3 border-t-4 border-r-4 border-foreground transition-all duration-50", isPressed && '-top-1.5 -right-1.5')} 
          />
          <motion.div 
            animate={{ scaleY: isPressed ? -1 : 1, scaleX: isPressed ? -1 : 1 }}
            className={cn("absolute bottom-0 left-0 w-3 h-3 border-b-4 border-l-4 border-foreground transition-all duration-50", isPressed && '-bottom-1.5 -left-1.5')} 
          />
          <motion.div 
            animate={{ scaleY: isPressed ? -1 : 1, scaleX: isPressed ? -1 : 1 }}
            className={cn("absolute bottom-0 right-0 w-3 h-3 border-b-4 border-r-4 border-foreground transition-all duration-50", isPressed && '-bottom-1.5 -right-1.5')} 
          />
        </motion.div>
      )}
      <AnimatePresence>
        {cursorState.label && (
          <motion.span
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            className="absolute whitespace-nowrap text-xs font-medium text-primary-foreground"
          >
            {cursorState.label}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
