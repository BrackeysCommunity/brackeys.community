import { Store } from "@tanstack/store";

export type JamEntry = {
  created_at: string;
  rating_count: number;
  url: string;
  game: {
    cover_color?: string;
    platforms: string[];
    short_text?: string | null;
    cover: string;
    url: string;
    user: {
      url: string;
      name: string;
      id: number;
    };
    title: string;
    id: number;
  };
  coolness: number;
  id: number;
};

type JamView = "jam" | "submissions";

type JamState = {
  joinedCount: string | null;
  submissionCount: string | null;
  ratingCount: string | null;
  submissions: JamEntry[];
  view: JamView;
  loading: boolean;
  error: string | null;
};

export const jamStore = new Store<JamState>({
  joinedCount: null,
  submissionCount: null,
  ratingCount: null,
  submissions: [],
  view: "jam",
  loading: false,
  error: null,
});

export function setJamView(view: JamView) {
  jamStore.setState((s) => ({ ...s, view }));
}

export function setJamData(data: {
  joinedCount: string;
  submissionCount: string;
  ratingCount: string;
  submissions: JamEntry[];
}) {
  jamStore.setState((s) => ({ ...s, ...data, loading: false, error: null }));
}

export function setJamLoading(loading: boolean) {
  jamStore.setState((s) => ({ ...s, loading }));
}

export function setJamError(error: string) {
  jamStore.setState((s) => ({ ...s, error, loading: false }));
}
