import {
  SignedIn,
  SignInButton,
  SignedOut,
  UserButton,
} from '@clerk/tanstack-react-start';
import { DiscordInfo, DiscordIcon } from './discord-info';

type HeaderUserProps = {
  onMenuOpen?: () => void;
  onMenuClose?: () => void;
};

export const HeaderUser = ({ onMenuOpen, onMenuClose }: HeaderUserProps) => {
  return (
    <>
      <SignedIn>
        <div
          onMouseEnter={onMenuOpen}
          onMouseLeave={onMenuClose}
          onClick={onMenuOpen}
          className="flex items-center justify-center"
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
        </div>
      </SignedIn>
      <SignedOut>
        <SignInButton />
      </SignedOut>
    </>
  );
}
