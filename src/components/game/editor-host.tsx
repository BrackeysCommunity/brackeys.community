import "@jams/engine/editor-ui/style.css";
import "@/styles/editor-ui.css";
import * as Hocuspocus from "@hocuspocus/provider";
import type { MountUi } from "@jams/engine";
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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { CanvasShell } from "@/components/canvas/shell/CanvasShell";
import { DEFAULT_SCENE as ENGINE_DEFAULT_SCENE } from "@/games/engine-editor";
import { activeUserStore, type ActiveUserProfile } from "@/lib/active-user-store";
import { presenceColor } from "@/lib/canvas/presence";
import type { FeatureFlagValues } from "@/lib/flags";
import { useFlags } from "@/lib/hooks/use-flag";
import { play, type SoundName } from "@/lib/sound";
import { toast } from "@/lib/toast";

import { EditorLoading } from "./editor-loading";
import { BlankCanvas } from "./game-canvas-loading";
import { DEFAULT_GAME, hostedGames, useLoaded, type HostedGame } from "./hosted-games";
import { LoadFailed } from "./load-failed";
import { GameSiteIsland } from "./site-island";

/** What the editor opens a project with. */
export type SiteProjectModules = {
  /** The game its `jams.project.json` names; null when it names none, as the dev server judges it. */
  game: GameDefinition | null;
  /** The game's DOM UI, mounted over the canvas while Play runs; null without one. */
  ui: MountUi | null;
  /** The scene opened when the URL names none. */
  defaultScene: string;
};

/**
 * A project the game room's editor can open: its `jams.project.json` id and
 * how to load the game it is edited with. Its name is the project file's,
 * from the dev server's listing.
 */
export type SiteProject = {
  id: string;
  load(): Promise<SiteProjectModules>;
  /** The game's debug layers (F3), beside the engine's. */
  debugLayers?: () => Promise<readonly DebugLayerFactory[]>;
};

const fromHosted = (hosted: HostedGame): SiteProject => ({
  id: hosted.id,
  load: () => hosted.load().then(({ game, ui, scene }) => ({ game, ui, defaultScene: scene.name })),
  debugLayers: () => hosted.debugLayers(),
});

const ENGINE_PROJECT: SiteProject = {
  id: "engine",
  load: () => Promise.resolve({ game: null, ui: null, defaultScene: ENGINE_DEFAULT_SCENE }),
};

/** Every game the site hosts, then the gameless engine project. */
export const SITE_PROJECTS: readonly SiteProject[] = [
  ...hostedGames().map(fromHosted),
  ENGINE_PROJECT,
];

/** The project `/game/<room>?edit=1` opens without `?project=`. */
export const DEFAULT_PROJECT = DEFAULT_GAME;

export const siteProject = (id: string): SiteProject | null =>
  SITE_PROJECTS.find((p) => p.id === id) ?? null;

/** Each project's name by id, as its `jams.project.json` says. */
export type ProjectNames = Readonly<Record<string, string>>;

/** The dev server's project listing (`@jams/engine/vite`'s `PROJECT_ROUTE`). */
const PROJECT_LISTING = "/__project";

/** The names the dev server's project listing gives, or none when it can't answer. */
export async function fetchProjectNames(
  fetch: (url: string) => Promise<Pick<Response, "ok" | "json">> = globalThis.fetch,
): Promise<ProjectNames> {
  try {
    const res = await fetch(PROJECT_LISTING);
    const body = res.ok ? ((await res.json()) as { projects?: unknown }) : null;
    const names: Record<string, string> = {};
    for (const p of Array.isArray(body?.projects) ? body.projects : []) {
      const { id, name } = (p ?? {}) as { id?: unknown; name?: unknown };
      if (typeof id === "string" && typeof name === "string") names[id] = name;
    }
    return names;
  } catch {
    return {};
  }
}

/** The site's projects as the switcher lists them, each by its file's name (its id until the listing answers). */
export const projectChoices = (names: ProjectNames) =>
  SITE_PROJECTS.map(({ id }) => ({ id, name: names[id] ?? id }));

/** The dev server's project names; null until it answers (an empty record when it can't). */
function useProjectNames(): ProjectNames | null {
  const [names, setNames] = useState<ProjectNames | null>(null);
  useEffect(() => {
    let live = true;
    void fetchProjectNames().then((got) => {
      if (live) setNames(got);
    });
    return () => {
      live = false;
    };
  }, []);
  return names;
}

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
  /** A project picked in the Project panel's switcher, or a scene's own project from the fallback notice. */
  onProjectChange?: (id: string, opts?: { scene?: string }) => void;
  /** The projects' names, from the dev server's listing; each project goes by its id without one. */
  projectNames?: ProjectNames;
  /** The project's server; default the dev server. */
  project?: Pick<EditorHost, "connect" | "assetUrl"> & Partial<Pick<EditorHost, "findScene">>;
};

/** jams.team as the editor's host: the site's toasts, sounds, identity, colours, flags and menu. */
export function useSiteEditorHost({
  title,
  onSceneChange,
  onProjectChange,
  projectNames,
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
  const [projectChange] = useState(
    () => (id: string, opts?: { scene?: string }) => projectChangeRef.current?.(id, opts),
  );
  const projects = useMemo(() => projectChoices(projectNames ?? {}), [projectNames]);

  return useMemo<EditorHost>(
    () => ({
      connect: server.connect,
      assetUrl: server.assetUrl,
      ...(server.findScene ? { findScene: server.findScene } : {}),
      projects,
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
    [server, identity, flag, sceneChange, projectChange, projects, title],
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
 * history entry; when another project holds the scene, the notice's action
 * opens it there. Picking a project in the Project panel opens its default
 * scene as a new history entry. Projects go by their files' names, from the
 * dev server's listing.
 */
export function SiteSceneEditor({ roomId, project, scene, onSceneChange }: SiteSceneEditorProps) {
  const known = project === undefined ? null : siteProject(project);
  const chosen = known ?? siteProject(DEFAULT_PROJECT)!;
  const unknown = project !== undefined && known === null ? project : null;
  const names = useProjectNames();
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
  const chosenName = names?.[chosen.id] ?? chosen.id;
  useEffect(() => {
    if (unknown === null || names === null) return;
    siteNotify.warning(`There's no project "${unknown}" here`, {
      id: "project-fallback",
      description: `${chosenName} opened instead.`,
    });
    goRef.current({ project: undefined }, true);
  }, [unknown, names, chosenName]);
  return (
    <ProjectSceneEditor
      key={chosen.id}
      roomId={roomId}
      project={chosen}
      scene={unknown === null ? scene : undefined}
      projectNames={names ?? undefined}
      onSceneChange={onSceneChange ?? ((id) => go({ scene: id }, true))}
      onProjectChange={(id, opts) =>
        go(
          { project: id === DEFAULT_PROJECT ? undefined : id, scene: opts?.scene, game: undefined },
          false,
        )
      }
    />
  );
}

function ProjectSceneEditor(props: ProjectSceneEditorProps) {
  const { project, roomId } = props;
  const load = useCallback(() => project.load(), [project]);
  const { value: modules, error, retry } = useLoaded(load);
  if (error !== null) {
    return (
      <CanvasShell topLeft={<GameSiteIsland title={roomId} />}>
        <BlankCanvas />
        <LoadFailed
          title={`The project "${project.id}" couldn't load`}
          error={error}
          onRetry={retry}
        />
      </CanvasShell>
    );
  }
  if (!modules) return <EditorLoading roomId={roomId} />;
  return <LoadedSceneEditor {...props} modules={modules} />;
}

type ProjectSceneEditorProps = {
  roomId: string;
  project: SiteProject;
  scene: string | undefined;
  projectNames: ProjectNames | undefined;
  onSceneChange: (id: string) => void;
  onProjectChange: (id: string, opts?: { scene?: string }) => void;
};

function LoadedSceneEditor({
  roomId,
  project,
  scene,
  projectNames,
  onSceneChange,
  onProjectChange,
  modules,
}: ProjectSceneEditorProps & { modules: SiteProjectModules }) {
  const [ready, setReady] = useState(false);
  const editing = scene ?? modules.defaultScene;
  const [debug] = useState(() => debugFor(project));
  const host = useSiteEditorHost({
    title: ready ? editing : roomId,
    onSceneChange,
    onProjectChange,
    ...(projectNames ? { projectNames } : {}),
  });
  return (
    <SceneEditor
      host={host}
      game={modules.game}
      ui={modules.ui}
      project={project.id}
      scene={editing}
      rapier={loadRapier}
      debug={debug}
      onReady={() => setReady(true)}
    />
  );
}
