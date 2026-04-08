import { Store } from "@tanstack/store";
import { client } from "@/orpc/client";

export type ActiveUserProfile = {
	discordUsername: string | null;
	discordId: string | null;
	avatarUrl: string | null;
	guildNickname: string | null;
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
