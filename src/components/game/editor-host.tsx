import "@jams/engine/editor-ui/style.css";
import "@/styles/editor-ui.css";
import * as Hocuspocus from "@hocuspocus/provider";
import { buildAtFrom } from "@jams/engine/collab";
import {
  devProjectHost,
  SceneEditor,
  type EditorCue,
  type EditorHost,
  type EditorIdentityInput,
} from "@jams/engine/editor-ui";
import { useStore } from "@tanstack/react-store";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { platformerGame } from "@/games/platformer";
import { activeUserStore, type ActiveUserProfile } from "@/lib/active-user-store";
import { presenceColor } from "@/lib/canvas/presence";
import type { FeatureFlagValues } from "@/lib/flags";
import { useFlags } from "@/lib/hooks/use-flag";
import { play, type SoundName } from "@/lib/sound";
import { toast } from "@/lib/toast";

import { BUNDLED_SCENE_ID } from "./platformer-scene";
import { GameSiteIsland } from "./site-island";

/** The project the game room's scenes belong to: the platformer's `jams.project.json`. */
export const SCENE_PROJECT = "platformer";

const loadRapier = () => import("@dimforge/rapier2d");

const loadDebug = () =>
  Promise.all([import("@jams/engine/debug"), import("@/games/platformer/debug")]).then(
    ([debug, layers]) => ({
      overlay: debug.createDebugOverlay,
      layers: layers.PLATFORMER_DEBUG_LAYERS,
    }),
  );

const CUE_SOUND: Record<EditorCue, SoundName> = {
  press: "press",
  toggle: "toggle",
  tab: "page",
  drop: "release",
  error: "error",
};

export const siteCue = (cue: EditorCue): void => play(CUE_SOUND[cue]);

export const sitePeerColor = (id: string): string => presenceColor(id).color;

/** The active user as the editor names them: guild nickname, else Discord username. */
export function siteIdentity(profile: ActiveUserProfile | null): EditorIdentityInput | undefined {
  const name = profile?.guildNickname ?? profile?.discordUsername;
  if (!profile || !name) return undefined;
  const avatarUrl = profile.inGuild
    ? (profile.guildAvatarUrl ?? profile.avatarUrl)
    : profile.avatarUrl;
  return { name, avatarUrl };
}

/** The dev server stamps builds with the same `VITE_BUILD_AT`, so the two agree on which build is newer. */
const DEV_OPTIONS = {
  hocuspocus: Hocuspocus,
  buildAt: buildAtFrom(import.meta.env.VITE_BUILD_AT),
};

const devProject = () => devProjectHost(DEV_OPTIONS);

export type SiteEditorHostOptions = {
  /** What the site menu's island names: the room, then the scene once the editor is up. */
  title: ReactNode;
  onSceneChange?: (id: string) => void;
  /** The project's server; default the dev server. */
  project?: Pick<EditorHost, "connect" | "assetUrl">;
};

/** jams.team as the editor's host: the site's toasts, sounds, identity, colours, flags and menu. */
export function useSiteEditorHost({
  title,
  onSceneChange,
  project,
}: SiteEditorHostOptions): EditorHost {
  const [server] = useState(() => project ?? devProject());
  const profile = useStore(activeUserStore, (s) => s.profile);
  const identity = useMemo(() => siteIdentity(profile), [profile]);

  const flags = useFlags();
  const flagsRef = useRef<FeatureFlagValues>(flags);
  const sceneChangeRef = useRef(onSceneChange);
  useEffect(() => {
    flagsRef.current = flags;
    sceneChangeRef.current = onSceneChange;
  });
  const [flag] = useState(
    () =>
      (name: string): boolean =>
        (flagsRef.current as Partial<Record<string, boolean>>)[name] ?? false,
  );
  const [sceneChange] = useState(() => (id: string) => sceneChangeRef.current?.(id));

  return useMemo<EditorHost>(
    () => ({
      connect: server.connect,
      assetUrl: server.assetUrl,
      ...(identity ? { identity } : {}),
      peerColor: sitePeerColor,
      notify: toast,
      cue: siteCue,
      flag,
      chrome: {
        topLeft: <GameSiteIsland title={title} />,
      },
      onSceneChange: sceneChange,
    }),
    [server, identity, flag, sceneChange, title],
  );
}

export type SiteSceneEditorProps = {
  roomId: string;
  /** The project scene to open, by id; default the bundled one. */
  scene?: string;
  onSceneChange?: (id: string) => void;
};

/**
 * The game room's `?edit=1`: the engine's scene editor on the platformer
 * project, in the site's chrome. The title names the room until the editor
 * is up, then the scene; `onSceneChange` keeps `scene` on the one it opened.
 */
export function SiteSceneEditor({ roomId, scene, onSceneChange }: SiteSceneEditorProps) {
  const [ready, setReady] = useState(false);
  const editing = scene ?? BUNDLED_SCENE_ID;
  const host = useSiteEditorHost({ title: ready ? editing : roomId, onSceneChange });
  return (
    <SceneEditor
      host={host}
      game={platformerGame}
      project={SCENE_PROJECT}
      scene={editing}
      rapier={loadRapier}
      debug={loadDebug}
      onReady={() => setReady(true)}
    />
  );
}
