import { SandboxUser } from '../../../spacetime-bindings';
import { CURSOR_SHADOW_FILTER, CURSOR_PATH } from '../constants';
import { generateColorScheme } from '../../../lib/colors';
import { useMemo } from 'react';

type CursorIconProps = {
  user: SandboxUser;
  isCurrentUser?: boolean;
};

export const CursorIcon = ({ user }: CursorIconProps) => {
  // Generate color scheme for this user
  const colorScheme = useMemo(
    () => generateColorScheme(user.color),
    [user.color],
  );

  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      style={{
        filter: CURSOR_SHADOW_FILTER,
      }}
    >
      <path
        d={CURSOR_PATH}
        fill={user.color}
        stroke={colorScheme.outline}
        strokeWidth="1.5"
      />
    </svg>
  );
};
