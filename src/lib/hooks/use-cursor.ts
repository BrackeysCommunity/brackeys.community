import { useState, useCallback, useRef } from 'react';
import { useEventListener } from 'ahooks';

export interface CursorState {
  type: 'default' | 'pointer' | 'text' | 'hidden' | 'magnetic';
  label?: string;
  targetRect?: DOMRect;
}

export function useCursorState() {
  const [state, setState] = useState<CursorState>({ type: 'default' });

  const onMouseEnter = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const magneticTarget = target.closest('[data-magnetic]') as HTMLElement;
    const cursorType = target.closest('[data-cursor]')?.getAttribute('data-cursor');
    const cursorLabel = target.closest('[data-cursor-label]')?.getAttribute('data-cursor-label');

    if (magneticTarget) {
      setState({
        type: 'magnetic',
        targetRect: magneticTarget.getBoundingClientRect(),
        label: cursorLabel || undefined,
      });
      return;
    }

    if (cursorType || cursorLabel) {
      setState({ 
        type: (cursorType as CursorState['type']) || 'pointer', 
        label: cursorLabel || undefined 
      });
    } else {
      const style = window.getComputedStyle(target);
      if (style.cursor === 'pointer') {
        setState({ type: 'pointer' });
      } else if (style.cursor === 'text') {
        setState({ type: 'text' });
      } else {
        setState({ type: 'default' });
      }
    }
  }, []);

  const onMouseLeave = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const magneticTarget = target.closest('[data-magnetic]') as HTMLElement;
    if (magneticTarget) {
      setState({ type: 'default' });
    }
  }, []);

  useEventListener('mouseover', onMouseEnter, { target: () => document.body });
  useEventListener('mouseout', onMouseLeave, { target: () => document.body });

  return state;
}

export function useMagnetic(strength = 0.2) {
  const ref = useRef<HTMLElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!ref.current) return;

    const { left, top, width, height } = ref.current.getBoundingClientRect();
    const centerX = left + width / 2;
    const centerY = top + height / 2;

    const distanceX = e.clientX - centerX;
    const distanceY = e.clientY - centerY;

    // Much tighter threshold for magnetism
    const threshold = Math.max(width, height) * 0.6;
    if (Math.abs(distanceX) < threshold && Math.abs(distanceY) < threshold) {
      setPosition({
        x: distanceX * strength,
        y: distanceY * strength,
      });
    } else {
      setPosition({ x: 0, y: 0 });
    }
  }, [strength]);

  const handleMouseLeave = useCallback(() => {
    setPosition({ x: 0, y: 0 });
  }, []);

  useEventListener('mousemove', handleMouseMove, { target: ref.current });
  useEventListener('mouseleave', handleMouseLeave, { target: ref.current });

  return { ref, position };
}
