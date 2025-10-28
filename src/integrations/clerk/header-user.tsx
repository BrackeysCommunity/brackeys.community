import {
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
} from '@clerk/tanstack-react-start';
import { DiscordIcon, DiscordInfo } from './discord-info';

type HeaderUserProps = {
  onMenuOpen?: () => void;
  onMenuClose?: () => void;
};

export const HeaderUser = ({ onMenuOpen, onMenuClose }: HeaderUserProps) => {
  return (
    <>
      <SignedIn>
        <button
          type="button"
          onMouseEnter={onMenuOpen}
          onMouseLeave={onMenuClose}
          onClick={onMenuOpen}
          className="flex items-center justify-center cursor-pointer"
        >
          <UserButton>
            <UserButton.UserProfilePage
              label="Discord"
              labelIcon={<DiscordIcon />}
              url="discord"
            >
              <DiscordInfo variant="compact" />
            </UserButton.UserProfilePage>
          </UserButton>
        </button>
      </SignedIn>
      <SignedOut>
        <SignInButton />
      </SignedOut>
    </>
  );
};
