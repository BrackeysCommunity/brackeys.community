import "@jams/engine/editor-ui/style.css";
import "@/styles/editor-ui.css";
import * as Hocuspocus from "@hocuspocus/provider";
import { buildAtFrom } from "@jams/engine/collab";
import type { DebugLayerFactory } from "@jams/engine/debug";
import {
  devProjectHost,
  SceneEditor,
  type EditorCue,
  type EditorHost,
  type EditorIdentityInput,
  type EditorNotify,
  type NotifyOptions,
} from "@jams/engine/editor-ui";
import type { GameDefinition } from "@jams/engine/game";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { platformerGame } from "@/games/platformer";
import { activeUserStore, type ActiveUserProfile } from "@/lib/active-user-store";
import { presenceColor } from "@/lib/canvas/presence";
import type { FeatureFlagValues } from "@/lib/flags";
import { useFlags } from "@/lib/hooks/use-flag";
import { play, type SoundName } from "@/lib/sound";
import { toast } from "@/lib/toast";

import {
  DEFAULT_SCENE as ENGINE_DEFAULT_SCENE,
  engineEditorGame,
} from "../../../scripts/engine-editor/game";
import { BUNDLED_SCENE_ID } from "./platformer-scene";
import { GameSiteIsland } from "./site-island";

/** A project the game room's editor can open: its `jams.project.json` id and name, and the game it is edited with. */
export type SiteProject = {
  id: string;
  name: string;
  /** The project's game; a project whose file names none is edited with the game its own editor uses. */
  game: GameDefinition;
  /** The scene opened when the URL names none. */
  defaultScene: string;
  /** The game's debug layers (F3), beside the engine's. */
  debugLayers?: () => Promise<readonly DebugLayerFactory[]>;
};

export const SITE_PROJECTS: readonly SiteProject[] = [
  {
    id: "platformer",
    name: "Platformer",
    game: platformerGame,
    defaultScene: BUNDLED_SCENE_ID,
    debugLayers: () => import("@/games/platformer/debug").then((m) => m.PLATFORMER_DEBUG_LAYERS),
  },
  { id: "engine", name: "Engine", game: engineEditorGame, defaultScene: ENGINE_DEFAULT_SCENE },
];

/** The project `/game/<room>?edit=1` opens without `?project=`. */
export const DEFAULT_PROJECT = "platformer";

export const siteProject = (id: string): SiteProject | null =>
  SITE_PROJECTS.find((p) => p.id === id) ?? null;

const PROJECT_CHOICES = SITE_PROJECTS.map(({ id, name }) => ({ id, name }));

const loadRapier = () => import("@dimforge/rapier2d");

const debugFor = (project: SiteProject) => () =>
  Promise.all([import("@jams/engine/debug"), project.debugLayers?.()]).then(([debug, layers]) => ({
    overlay: debug.createDebugOverlay,
    ...(layers ? { layers } : {}),
  }));

const CUE_SOUND: Record<EditorCue, SoundName> = {
  press: "press",
  toggle: "toggle",
  tab: "page",
  drop: "release",
  error: "error",
};

export const siteCue = (cue: EditorCue): void => play(CUE_SOUND[cue]);

/** The site's toasts at the top centre while the editor is up, clear of its columns and its dock. */
const EDITOR_TOAST = { position: "top-center" } as const;

export const siteNotify: EditorNotify = Object.assign(
  (message: string, opts?: NotifyOptions) => toast(message, { ...opts, ...EDITOR_TOAST }),
  {
    success: (message: string, opts?: NotifyOptions) =>
      toast.success(message, { ...opts, ...EDITOR_TOAST }),
    warning: (message: string, opts?: NotifyOptions) =>
      toast.warning(message, { ...opts, ...EDITOR_TOAST }),
    error: (message: string, opts?: NotifyOptions) =>
      toast.error(message, { ...opts, ...EDITOR_TOAST }),
  },
);

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
  /** A project picked in the Project panel's switcher. */
  onProjectChange?: (id: string) => void;
  /** The project's server; default the dev server. */
  project?: Pick<EditorHost, "connect" | "assetUrl"> & Partial<Pick<EditorHost, "findScene">>;
};

/** jams.team as the editor's host: the site's toasts, sounds, identity, colours, flags and menu. */
export function useSiteEditorHost({
  title,
  onSceneChange,
  onProjectChange,
  project,
}: SiteEditorHostOptions): EditorHost {
  const [server] = useState(() => project ?? devProject());
  const profile = useStore(activeUserStore, (s) => s.profile);
  const identity = useMemo(() => siteIdentity(profile), [profile]);

  const flags = useFlags();
  const flagsRef = useRef<FeatureFlagValues>(flags);
  const sceneChangeRef = useRef(onSceneChange);
  const projectChangeRef = useRef(onProjectChange);
  useEffect(() => {
    flagsRef.current = flags;
    sceneChangeRef.current = onSceneChange;
    projectChangeRef.current = onProjectChange;
  });
  const [flag] = useState(
    () =>
      (name: string): boolean =>
        (flagsRef.current as Partial<Record<string, boolean>>)[name] ?? false,
  );
  const [sceneChange] = useState(() => (id: string) => sceneChangeRef.current?.(id));
  const [projectChange] = useState(() => (id: string) => projectChangeRef.current?.(id));

  return useMemo<EditorHost>(
    () => ({
      connect: server.connect,
      assetUrl: server.assetUrl,
      ...(server.findScene ? { findScene: server.findScene } : {}),
      projects: PROJECT_CHOICES,
      onProjectChange: projectChange,
      ...(identity ? { identity } : {}),
      peerColor: sitePeerColor,
      notify: siteNotify,
      cue: siteCue,
      flag,
      chrome: {
        topLeft: <GameSiteIsland title={title} />,
      },
      onSceneChange: sceneChange,
    }),
    [server, identity, flag, sceneChange, projectChange, title],
  );
}

export type SiteSceneEditorProps = {
  roomId: string;
  /** The project to open, by id (`?project=`); default the platformer. */
  project?: string;
  /** The project scene to open, by id or name; default the project's own. */
  scene?: string;
  /** Default: the room's route follows, its `?scene=` set to the scene the editor opened. */
  onSceneChange?: (id: string) => void;
};

type Search = Record<string, unknown>;

/** `prev` with `patch` applied, an undefined value dropping its key. */
function patchSearch(prev: Search, patch: Search): Search {
  const next: Search = { ...prev, ...patch };
  for (const [key, value] of Object.entries(patch)) if (value === undefined) delete next[key];
  return next;
}

/**
 * The game room's `?edit=1`: the engine's scene editor in the site's chrome,
 * on the project `?project=` names (the platformer by default; one the site
 * doesn't know is said once and dropped from the route). The title names the
 * room until the editor is up, then the scene. When the editor opens another
 * scene than `scene` (it isn't in the project), the editor's notice says so
 * through the site's toast and the route's `?scene=` follows, replacing the
 * history entry. Picking a project in the Project panel opens its default
 * scene as a new history entry.
 */
export function SiteSceneEditor({ roomId, project, scene, onSceneChange }: SiteSceneEditorProps) {
  const known = project === undefined ? null : siteProject(project);
  const chosen = known ?? siteProject(DEFAULT_PROJECT)!;
  const unknown = project !== undefined && known === null ? project : null;
  const navigate = useNavigate();
  const go = (patch: Search, replace: boolean) =>
    void navigate({
      to: "/game/$roomId",
      params: { roomId },
      search: (prev: Search) => patchSearch(prev, patch),
      replace,
    });
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });
  useEffect(() => {
    if (unknown === null) return;
    siteNotify.warning(`There's no project "${unknown}" here`, {
      id: "project-fallback",
      description: `${chosen.name} opened instead.`,
    });
    goRef.current({ project: undefined }, true);
  }, [unknown, chosen.name]);
  return (
    <ProjectSceneEditor
      key={chosen.id}
      roomId={roomId}
      project={chosen}
      scene={unknown === null ? scene : undefined}
      onSceneChange={onSceneChange ?? ((id) => go({ scene: id }, true))}
      onProjectChange={(id) =>
        go({ project: id === DEFAULT_PROJECT ? undefined : id, scene: undefined }, false)
      }
    />
  );
}

function ProjectSceneEditor({
  roomId,
  project,
  scene,
  onSceneChange,
  onProjectChange,
}: {
  roomId: string;
  project: SiteProject;
  scene: string | undefined;
  onSceneChange: (id: string) => void;
  onProjectChange: (id: string) => void;
}) {
  const [ready, setReady] = useState(false);
  const editing = scene ?? project.defaultScene;
  const [debug] = useState(() => debugFor(project));
  const host = useSiteEditorHost({
    title: ready ? editing : roomId,
    onSceneChange,
    onProjectChange,
  });
  return (
    <SceneEditor
      host={host}
      game={project.game}
      project={project.id}
      scene={editing}
      rapier={loadRapier}
      debug={debug}
      onReady={() => setReady(true)}
    />
  );
}
