import { Store } from "@tanstack/store";

import { client } from "@/orpc/client";

export type ActiveUserProfile = {
  discordUsername: string | null;
  discordId: string | null;
  avatarUrl: string | null;
  guildNickname: string | null;
  urlStub: string | null;
  /** The directory's open-to-work flag. Mirrored here so the header's quick
      toggle can render it without a profile query — see
      `useAvailabilityToggle`, which is the only thing that writes it. */
  availableForWork: boolean;
  isStaff: boolean;
  isAdmin: boolean;
};

type ActiveUserState = {
  profile: ActiveUserProfile | null;
  isPending: boolean;
};

export const activeUserStore = new Store<ActiveUserState>({
  profile: null,
  isPending: false,
});

export async function fetchActiveUserProfile() {
  activeUserStore.setState((s) => ({ ...s, isPending: true }));
  try {
    const data = await client.getMyProfile({});
    activeUserStore.setState((s) => ({
      ...s,
      profile: data?.profile
        ? {
            discordUsername: data.profile.discordUsername,
            discordId: data.profile.discordId,
            avatarUrl: data.profile.avatarUrl,
            guildNickname: data.profile.guildNickname,
            urlStub: data.urlStub,
            availableForWork: data.profile.availableForWork ?? false,
            isStaff: data.isStaff,
            isAdmin: data.isAdmin,
          }
        : null,
      isPending: false,
    }));
  } catch {
    activeUserStore.setState((s) => ({ ...s, profile: null, isPending: false }));
  }
}

export function clearActiveUserProfile() {
  activeUserStore.setState((s) => ({ ...s, profile: null, isPending: false }));
}

export function updateActiveUserProfile(updates: Partial<ActiveUserProfile>) {
  activeUserStore.setState((s) => ({
    ...s,
    profile: s.profile ? { ...s.profile, ...updates } : null,
  }));
}
