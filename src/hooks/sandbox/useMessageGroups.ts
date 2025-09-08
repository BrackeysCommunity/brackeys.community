import { useMemo } from 'react';
import { SandboxMessage } from '../../spacetime-bindings';
import { MESSAGE_POSITION_TOLERANCE_PX } from '../../components/sandbox/constants';

export type MessageGroupData = {
  position: { x: number; y: number };
  messages: SandboxMessage[];
};

export function useMessageGroups(messages: SandboxMessage[]) {
  return useMemo(() => {
    const groups = new Map<string, MessageGroupData>();
    const tolerance = MESSAGE_POSITION_TOLERANCE_PX;

    messages.forEach(message => {
      let foundGroup = false;

      for (const [, group] of groups) {
        if (
          Math.abs(group.position.x - message.positionX) < tolerance &&
          Math.abs(group.position.y - message.positionY) < tolerance
        ) {
          group.messages.push(message);
          foundGroup = true;
          break;
        }
      }

      if (!foundGroup) {
        const key = `${Math.round(message.positionX)}-${Math.round(message.positionY)}`;
        groups.set(key, {
          position: { x: message.positionX, y: message.positionY },
          messages: [message],
        });
      }
    });

    return groups;
  }, [messages]);
}
