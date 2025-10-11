import { useState, useEffect } from 'react';
import { motion, TargetAndTransition, VariantLabels } from 'motion/react';
import { SandboxUser, LiveTyping } from '@/spacetime-bindings';
import { cn } from '@/lib/utils';
import { CursorIcon } from './CursorIcon';
import { TypingBubble } from '../TypingBubble';
import { useSandbox } from '@/context/sandboxContext';

type SimpleTypingState = {
  text: string;
  isTyping: boolean;
  selectionStart: number;
  selectionEnd: number;
};

type CursorContainerProps = {
  user: SandboxUser;
  isCurrentUser?: boolean;
  typingState?: LiveTyping | SimpleTypingState;
  onTypingChange?: (
    text: string,
    selectionStart: number,
    selectionEnd: number,
  ) => void;
  onTypingClose?: () => void;
  onSendMessage?: (text: string, x: number, y: number) => void;
};

type CursorPosition = {
  x: number;
  y: number;
};

const getUserPosition = (user: SandboxUser): CursorPosition => ({
  x: user.cursorX,
  y: user.cursorY,
});

export const CursorContainer = ({
  user,
  isCurrentUser,
  typingState,
  onTypingChange,
  onTypingClose,
  onSendMessage,
}: CursorContainerProps) => {
  const [position, setPosition] = useState<CursorPosition>(() =>
    getUserPosition(user),
  );
  const { cursorState } = useSandbox();

  useEffect(() => {
    const newPosition = getUserPosition(user);
    setPosition((prev) => {
      // Only update if position actually changed to avoid unnecessary re-renders
      if (prev.x !== newPosition.x || prev.y !== newPosition.y) {
        return newPosition;
      }
      return prev;
    });
  }, [user.cursorX, user.cursorY]);

  const isTyping = typingState?.isTyping || false;

  const cursorIconAnimation: TargetAndTransition | VariantLabels | undefined =
    isCurrentUser
      ? {
          scale: [
            cursorState === 'interactive' ? 1.2 : 1,
            cursorState === 'typing' ? 0.8 : 1,
          ],
          padding: [
            cursorState === 'interactive' ? '0 4px 4px 0' : '0',
            cursorState === 'typing' ? '0' : '0',
          ],
          opacity: cursorState === 'typing' ? 0.4 : 1,
          filter:
            cursorState === 'interactive' ? 'brightness(1.5)' : 'brightness(1)',
        }
      : undefined;

  return (
    <div
      className={cn(
        'absolute z-10',
        isCurrentUser && isTyping
          ? 'pointer-events-auto'
          : 'pointer-events-none',
      )}
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
      }}
    >
      <div className="relative">
        <motion.div
          animate={cursorIconAnimation}
          transition={{ duration: 0.2 }}
        >
          <CursorIcon user={user} isCurrentUser={isCurrentUser} />
        </motion.div>

        {typingState && (
          <TypingBubble
            user={user}
            isCurrentUser={isCurrentUser}
            typingState={typingState}
            onTypingChange={onTypingChange}
            onTypingClose={onTypingClose}
            onSendMessage={
              onSendMessage
                ? (text) => onSendMessage(text, position.x, position.y)
                : undefined
            }
          />
        )}
      </div>
    </div>
  );
};
