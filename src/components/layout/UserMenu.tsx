import { Logout03Icon, Share01Icon, UserIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { motion } from "framer-motion";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { activeUserStore } from "@/lib/active-user-store";
import { authClient } from "@/lib/auth-client";
import { useMagnetic } from "@/lib/hooks/use-cursor";

const springTransition = { type: "spring", stiffness: 1000, damping: 30, mass: 0.1 } as const;

interface UserMenuProps {
  user: {
    id: string;
    name?: string | null;
    image?: string | null;
  };
}

export function UserMenu({ user }: UserMenuProps) {
  const { ref, position } = useMagnetic(0.2);
  const navigate = useNavigate();
  const activeProfile = useStore(activeUserStore, (s) => s.profile);
  const profileSlug = activeProfile?.urlStub ?? user.id;

  return (
    <DropdownMenu>
      <motion.div
        ref={ref as React.RefObject<HTMLDivElement>}
        data-magnetic
        data-cursor-no-drift
        animate={{ x: position.x, y: position.y }}
        transition={springTransition}
        className="relative z-10 inline-flex"
      >
        <DropdownMenuTrigger className="flex items-center gap-2 border border-muted bg-card/40 px-3 py-1.5 font-mono text-xs font-bold tracking-widest text-foreground transition-colors outline-none hover:border-primary hover:text-primary">
          {user.image ? (
            <img src={user.image} alt="" className="h-6 w-6 rounded-full" />
          ) : (
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted">
              <HugeiconsIcon icon={UserIcon} size={14} />
            </div>
          )}
          <span className="max-w-[100px] truncate uppercase">{user.name ?? "USER"}</span>
        </DropdownMenuTrigger>
      </motion.div>

      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="min-w-[180px] border border-muted bg-background/95 p-1 backdrop-blur-md"
      >
        <DropdownMenuItem
          className="font-mono text-xs font-bold tracking-widest uppercase"
          render={<Link to="/profile" />}
        >
          <HugeiconsIcon icon={UserIcon} size={14} />
          MY PROFILE
        </DropdownMenuItem>
        <DropdownMenuItem
          className="font-mono text-xs font-bold tracking-widest uppercase"
          render={
            <Link
              data-testid="view-public-link"
              to="/profile/$userId"
              params={{ userId: profileSlug }}
            />
          }
        >
          <HugeiconsIcon icon={Share01Icon} size={14} />
          VIEW PUBLIC
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="font-mono text-xs font-bold tracking-widest text-destructive uppercase"
          onClick={async () => {
            await authClient.signOut({
              fetchOptions: {
                onSuccess: () => navigate({ reloadDocument: true }),
              },
            });
          }}
        >
          <HugeiconsIcon icon={Logout03Icon} size={14} />
          SIGN OUT
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
