import {
  SignedIn,
  SignInButton,
  SignedOut,
  UserButton,
} from '@clerk/tanstack-react-start';

export default function HeaderUser() {
  return (
    <>
      <SignedIn>
        <UserButton />
      </SignedIn>
      <SignedOut>
        <SignInButton />
      </SignedOut>
    </>
  );
}
