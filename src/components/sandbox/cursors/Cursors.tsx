import { AnimatePresence } from 'motion/react';
import { SandboxUser, LiveTyping } from '../../../spacetime-bindings';
import { CursorContainer } from './Cursor';

type SimpleTypingState = {
  text: string;
  isTyping: boolean;
  selectionStart: number;
  selectionEnd: number;
};

type CursorLayerProps = {
  users: SandboxUser[];
  currentUserId?: string;
  typingStates?: Map<string, LiveTyping>;
  isTyping?: boolean;
  typingText?: string;
  onTypingChange?: (
    text: string,
    selectionStart: number,
    selectionEnd: number,
  ) => void;
  onTypingClose?: () => void;
  onSendMessage?: (text: string, x: number, y: number) => void;
};

export const Cursors = ({
  users,
  currentUserId,
  typingStates,
  isTyping,
  typingText,
  onTypingChange,
  onTypingClose,
  onSendMessage,
}: CursorLayerProps) => {
  const currentUser = users.find(
    (user) => user.identity.toHexString() === currentUserId,
  );
  const otherUsers = users.filter(
    (user) => user.identity.toHexString() !== currentUserId,
  );

  // Create a simplified typing state for the current user when typing
  const currentUserTypingState: SimpleTypingState | undefined =
    isTyping && currentUser
      ? {
          text: typingText || '',
          isTyping: true,
          selectionStart: 0,
          selectionEnd: 0,
        }
      : undefined;

  return (
    <div className="absolute inset-0 pointer-events-none [&:hover]:cursor-none">
      <AnimatePresence>
        {otherUsers.map((user) => {
          const userId = user.identity.toHexString();
          const typingState = typingStates?.get(userId);
          return (
            <CursorContainer
              key={userId}
              user={user}
              typingState={typingState}
            />
          );
        })}
      </AnimatePresence>
      {currentUser && (
        <CursorContainer
          user={currentUser}
          isCurrentUser
          typingState={currentUserTypingState}
          onTypingChange={onTypingChange}
          onTypingClose={onTypingClose}
          onSendMessage={onSendMessage}
        />
      )}
    </div>
  );
};
