import { useNavigate } from '@tanstack/react-router';
import { useActiveUser, useAuthHelpers } from '../../store';
import { DiscordLogo } from '../icons/DiscordLogo';
import { Button } from '../ui/Button';

const BUTTON_CONTENT = {
  cta: 'Join today!',
  visit: 'Visit server',
  login: 'Login with Discord',
};

interface LoginButtonProps {
  className?: string;
}

export const LoginButton = ({ className }: LoginButtonProps) => {
  const { user, isLoading } = useActiveUser();
  const { signInWithDiscord } = useAuthHelpers();
  const navigate = useNavigate();

  const handleClick = async () => {
    if (user) {
      navigate({ to: '/profile' });
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
      {user
        ? user.discord.guildMember
          ? BUTTON_CONTENT.visit
          : BUTTON_CONTENT.cta
        : BUTTON_CONTENT.login}
    </Button>
  );
};
