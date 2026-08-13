import { Logout03Icon, Settings02Icon, Share01Icon, UserIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useState } from "react";

import { AppSettingsDialog } from "@/components/layout/AppSettingsDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/user-avatar";
import { activeUserStore } from "@/lib/active-user-store";
import { authClient } from "@/lib/auth-client";
import { profileLinkParams } from "@/lib/profile-links";
import { truncateMiddle } from "@/lib/utils";

interface UserMenuProps {
  user: {
    id: string;
    name?: string | null;
    image?: string | null;
  };
}

export function UserMenu({ user }: UserMenuProps) {
  const navigate = useNavigate();
  const activeProfile = useStore(activeUserStore, (s) => s.profile);
  const profileParams = profileLinkParams({ id: user.id, urlStub: activeProfile?.urlStub });
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        {/* Same button as the settings cog and the bell — same variant, same
            size, so the emboss depth matches; only the padding comes off, to
            let the avatar run to the border. */}
        <DropdownMenuTrigger
          aria-label="Account menu"
          render={<Button variant="outline" size="icon-lg" className="overflow-hidden p-0" />}
        >
          <UserAvatar
            avatarUrl={user.image}
            username={user.name}
            // 34px + the button's 1px border each side fills the 36px frame.
            size={34}
            // The button already draws the frame — the avatar's own hairline
            // would read as a second border inside it.
            className="rounded-none after:hidden"
          />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" sideOffset={8} className="min-w-[180px]">
          {/* The name row is a group label, not an item — it takes no focus
              and no hover. base-ui requires it to sit inside a Group, which
              it then labels. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel className="border-b border-muted/40 text-xs text-foreground">
              {truncateMiddle(user.name ?? "USER", 18)}
            </DropdownMenuLabel>
            <DropdownMenuItem render={<Link to="/profile" />}>
              <HugeiconsIcon icon={UserIcon} size={14} />
              My profile
            </DropdownMenuItem>
            <DropdownMenuItem
              render={
                <Link data-testid="view-public-link" to="/profile/$userId" params={profileParams} />
              }
            >
              <HugeiconsIcon icon={Share01Icon} size={14} />
              View public
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
              <HugeiconsIcon icon={Settings02Icon} size={14} />
              Settings
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive"
            onClick={async () => {
              await authClient.signOut({
                fetchOptions: {
                  onSuccess: () => navigate({ reloadDocument: true }),
                },
              });
            }}
          >
            <HugeiconsIcon icon={Logout03Icon} size={14} />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AppSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
