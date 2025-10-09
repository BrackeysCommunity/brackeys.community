import { useAuth } from '../../context/useAuth';
import { Button } from '../ui/Button';
import { DiscordLogo } from '../icons/DiscordLogo';
import { useNavigate } from '@tanstack/react-router';

const BUTTON_CONTENT = {
  dashboard: 'Go to Dashboard',
  login: 'Login with Discord',
};

interface LoginButtonProps {
  className?: string;
}

export const LoginButton = ({ className }: LoginButtonProps) => {
  const {
    signInWithDiscord,
    state: { isLoading, user },
  } = useAuth();
  const navigate = useNavigate();

  const handleClick = async () => {
    if (user) {
      navigate({ to: '/dashboard' });
    } else {
      // Trigger Discord OAuth
      await signInWithDiscord();
    }
  };

  return (
    <Button
      variant="primary"
      size="lg"
      onClick={handleClick}
      loading={isLoading}
      icon={<DiscordLogo className="w-5 h-5" />}
      className={className}
      aria-label={user ? 'Go to your dashboard' : 'Login with Discord'}
      fullWidth
    >
      {user ? BUTTON_CONTENT.dashboard : BUTTON_CONTENT.login}
    </Button>
  );
};
