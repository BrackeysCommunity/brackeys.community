import { useStore } from "@tanstack/react-store";

import { activeUserStore } from "@/lib/active-user-store";
import {
  memberAvatarUrl,
  memberDisplayName,
  type MemberIdentityFields,
  type MemberNameFields,
  type MemberViewer,
} from "@/lib/member-name";

/**
 * The viewer's side of `memberDisplayName` / `memberAvatarUrl`, read once
 * from the session profile. Public, edge-cached reads carry both faces of
 * every member and never know who is asking, so the choice happens here at
 * render: anonymous and not-yet-loaded viewers get the global face, and the
 * page swaps to the guild face once `getMyProfile` says the viewer is in.
 */
export function useMemberViewer(): MemberViewer {
  const inGuild = useStore(activeUserStore, (s) => s.profile?.inGuild ?? false);
  return { inGuild };
}

export function useMemberIdentity() {
  const viewer = useMemberViewer();
  return {
    viewer,
    name: <F>(fields: MemberNameFields, fallback: F) => memberDisplayName(fields, viewer, fallback),
    avatarUrl: (fields: Pick<MemberIdentityFields, "avatarUrl" | "guildAvatarUrl">) =>
      memberAvatarUrl(fields, viewer),
  };
}
