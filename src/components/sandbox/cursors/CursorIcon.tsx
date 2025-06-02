import { SandboxUser } from '../../../api/spacetime-db'
import { CURSOR_SHADOW_FILTER, CURSOR_PATH } from '../constants'

type CursorIconProps = {
  user: SandboxUser
  isCurrentUser?: boolean
}

export const CursorIcon = ({ user }: CursorIconProps) => {
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
        stroke="rgba(255,255,255,0.9)"
        strokeWidth="1.5"
      />
    </svg>
  )
} 