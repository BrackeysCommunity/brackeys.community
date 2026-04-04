import { Store } from "@tanstack/store";
import type { Session } from "@/lib/auth-client";

type AuthState = {
  session: Session | null;
  isPending: boolean;
};

export const authStore = new Store<AuthState>({
  session: null,
  isPending: true,
});

export function setAuthSession(session: Session | null) {
  authStore.setState((s) => ({ ...s, session, isPending: false }));
}
