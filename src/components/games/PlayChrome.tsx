import {
  Flag02Icon,
  FloppyDiskIcon,
  FullScreenIcon,
  InformationCircleIcon,
  Login01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ORPCError } from "@orpc/client";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";

import { CanvasShell, Island } from "@/components/canvas/shell/CanvasShell";
import { ShellTitle, SiteIsland } from "@/components/canvas/shell/SiteIsland";
import { LoadFailed } from "@/components/game/load-failed";
import { NotFoundPage } from "@/components/layout/NotFoundPage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Confirm } from "@/components/ui/confirm";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ReportDialog } from "@/components/ui/report-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { SimpleTooltip } from "@/components/ui/tooltip";
import { UserAvatar } from "@/components/ui/user-avatar";
import { authClient, signInWithDiscord } from "@/lib/auth-client";
import type { PlayPayload } from "@/lib/engine/game-play";
import { engineGamesAllowed } from "@/lib/engine/guard";
import type { HostServer } from "@/lib/engine/host-server";
import {
  localPlayPrefs,
  localPlaySaves,
  SIGNED_OUT_SAVES_DESCRIBE,
} from "@/lib/engine/local-saves";
import type { PlayRefusal } from "@/lib/engine/release-access";
import { siteSaveStore } from "@/lib/engine/save-store";
import { useFlagBlocks } from "@/lib/hooks/use-flag";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import { pageTitle } from "@/lib/site-meta";
import { toast } from "@/lib/toast";
import { client, orpc } from "@/orpc/client";

import { KeepSavesDialog } from "./KeepSavesDialog";
import { PlayFrame } from "./PlayFrame";
import { SaveNotice } from "./SaveNotice";

/** What `/play/<version>` accepts: the live version, the preview, or a version number. */
export const PLAY_VERSION = /^(latest|preview|[1-9]\d{0,8})$/;

export const playPath = (projectId: string, version: string): string =>
  `/games/${projectId}/play/${version}`;

export const SIGN_IN_MESSAGE = "Signing in reloads the game.";

/** Why the page shows no frame, in words that never say the viewer was refused. */
export type PlayUnavailableReason = "hidden" | "collected" | "unavailable";

export const PLAY_UNAVAILABLE_MESSAGE: Record<PlayUnavailableReason, string> = {
  hidden:
    "This version of the game is hidden while staff look into it. The game's page lists the versions you can still play.",
  collected:
    "This version of the game was removed and its files are gone. The game's page lists the versions you can still play.",
  unavailable:
    "There's no version of this game here for you to play. It may not be published yet, or the link may have changed.",
};

const REFUSAL_REASON: Record<PlayRefusal, PlayUnavailableReason> = {
  hidden: "hidden",
  collected: "collected",
  // Refused and missing read the same, so a link leaks nothing about who may play it.
  forbidden: "unavailable",
  "not-found": "unavailable",
};

/**
 * The reason a `getGamePlay` failure shows, `null` for a not-found that names
 * none (the flag or the guard), or `undefined` when it isn't a refusal at all.
 */
export function refusalOf(error: unknown): PlayUnavailableReason | null | undefined {
  if (!(error instanceof ORPCError) || error.code !== "NOT_FOUND") return undefined;
  const reason = (error.data as { reason?: unknown } | undefined)?.reason;
  return typeof reason === "string" && reason in REFUSAL_REASON
    ? REFUSAL_REASON[reason as PlayRefusal]
    : null;
}

/** True when hosted games are off for this viewer or this deployment. */
export function useEngineGamesBlocked(): boolean {
  const flagOff = useFlagBlocks("engine-games-enabled");
  return flagOff || !engineGamesAllowed();
}

/**
 * The play payload. Fetched once per page: a refetch could mint a new private
 * frame URL, and a new URL reloads the game.
 */
export function usePlayQuery(projectId: string, version: string, enabled: boolean) {
  return useQuery({
    ...orpc.getGamePlay.queryOptions({ input: { projectId, version } }),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: (count, error) => refusalOf(error) === undefined && count < 2,
  });
}

/** This browser's saves and preferences for a project, and the save menu's sentence. */
export function useLocalPlayStores(projectId: string, describe: (stored: string) => string) {
  const saves = useMemo(() => localPlaySaves(projectId), [projectId]);
  const prefs = useMemo(() => localPlayPrefs(projectId), [projectId]);
  return {
    saves: () => saves,
    describe: () => {
      const stored = saves.describe;
      // A memory fallback says so itself; only browser storage gets the page's own sentence.
      return stored === SIGNED_OUT_SAVES_DESCRIBE ? describe(stored) : stored;
    },
    prefs,
  };
}

/**
 * The play page's saves: the viewer's account through the save API when
 * signed in, this browser's otherwise. Preferences stay in this browser
 * either way. Signing in reloads the page, so the store is picked once the
 * session is known.
 */
export function usePlayStores(projectId: string, signedIn: boolean) {
  const local = useLocalPlayStores(projectId, (stored) => stored);
  const site = useMemo(() => (signedIn ? siteSaveStore(projectId) : null), [projectId, signedIn]);
  return {
    saves: () => site ?? local.saves(),
    describe: () => (site ? site.describe : local.describe()),
    prefs: local.prefs,
    /** This browser's saves, whichever store the frame uses. */
    local: local.saves(),
    /** The account's saves, or null signed out. */
    site,
  };
}

/** The tab's title once a release loads: its game and version, so tabs and history tell games apart. */
export function usePlayTitle(play: Pick<PlayPayload, "title" | "version"> | undefined): void {
  const title = play ? pageTitle(`${play.title} v${play.version}`) : null;
  useEffect(() => {
    if (title === null) return;
    const before = document.title;
    document.title = title;
    return () => {
      document.title = before;
    };
  }, [title]);
}

/**
 * Whether any dialog or popover is open over the page, so the game pauses
 * under it. Watches the DOM rather than each dialog's state: the shared
 * report and confirm dialogs portal to the body and don't all report it.
 */
function useOverlayOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () =>
      setOpen(document.querySelector('[role="dialog"], [role="alertdialog"]') !== null);
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return open;
}

/** The full-window 404 for a game that can't be played here, with the reason when there is one. */
export function PlayUnavailable({ reason }: { reason?: PlayUnavailableReason | null }) {
  return (
    <div className="h-full overflow-y-auto px-4">
      <NotFoundPage
        subject={reason ? "Game" : "Page"}
        {...(reason ? { message: PLAY_UNAVAILABLE_MESSAGE[reason] } : {})}
      />
    </div>
  );
}

function PlayLoading() {
  return (
    <div role="status" aria-label="Loading the game" className="h-full w-full bg-black p-6">
      <Skeleton className="h-full w-full bg-white/5" />
    </div>
  );
}

/** `/games/<project>/play/<version>`: the gate, the payload, then the chrome around the frame. */
export function PlayPage({ projectId, version }: { projectId: string; version: string }) {
  const blocked = useEngineGamesBlocked();
  const valid = PLAY_VERSION.test(version);
  const query = usePlayQuery(projectId, version, !blocked && valid);

  if (blocked || !valid) return <PlayUnavailable />;
  if (query.isPending) return <PlayLoading />;
  // A failed reload for a new release keeps the game it has.
  if (query.isError && !query.data) {
    const reason = refusalOf(query.error);
    if (reason !== undefined) return <PlayUnavailable reason={reason} />;
    return (
      <div className="relative h-full w-full">
        <LoadFailed
          title="This game couldn't load"
          error={query.error.message}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }
  return <PlayChrome play={query.data} version={version} onReload={() => void query.refetch()} />;
}

/** Only a game that saves to the site promises to keep saves on sign-in. */
export const signInLabel = (mode: PlayPayload["saveMode"]): string =>
  mode === "site" ? "Sign in to keep your saves" : "Sign in";

/** Asks before signing in, since the reload restarts the game; raised by the chrome's button and the site menu's item. */
function SignInConfirm({
  label,
  callbackURL,
  open,
  onOpenChange,
}: {
  label: string;
  callbackURL: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Confirm
      title={`${label}?`}
      message={SIGN_IN_MESSAGE}
      confirmText="Sign in"
      open={open}
      onOpenChange={onOpenChange}
      onConfirm={async () => {
        await signInWithDiscord("game", { callbackURL });
      }}
    />
  );
}

function SignInButton({
  label,
  phone,
  onClick,
}: {
  label: string;
  phone: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={onClick}
      {...(phone && label !== "Sign in" ? { tooltip: label, "aria-label": label } : {})}
    >
      <HugeiconsIcon icon={Login01Icon} data-icon="inline-start" />
      {phone ? "Sign in" : label}
    </Button>
  );
}

/** The play page around a release's frame, in the takeover shell's islands. */
export function PlayChrome({
  play,
  version,
  onReload,
}: {
  play: PlayPayload;
  version: string;
  /** Loads the payload again when the channel moves to a new release. */
  onReload?: () => void;
}) {
  const phone = useIsMobile();
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const user = session?.user ?? null;
  const signedIn = user !== null;
  const signInId = session?.session?.id ?? user?.id ?? null;
  const dialogOpen = useOverlayOpen();
  const [signInAsked, setSignInAsked] = useState(false);
  const askSignIn = () => setSignInAsked(true);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const hostRef = useRef<HostServer | null>(null);
  const { projectId } = play;
  usePlayTitle(play);

  const stores = usePlayStores(projectId, signedIn);

  useEffect(() => {
    hostRef.current?.notifySavesChanged();
  }, [signedIn]);

  const fullscreen = () => {
    const frame = iframeRef.current;
    if (!frame?.requestFullscreen) return;
    frame.requestFullscreen().catch(() => {
      toast.error("This browser won't show the game full screen.");
    });
  };

  const report = async (reason: string) => {
    try {
      await client.reportGame({ projectId, version: play.version, reason });
      toast.success("Thanks. Staff will take a look.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The report didn't send. Try again.");
      throw error;
    }
  };

  const gamePage = <Link to="/games/$projectId" params={{ projectId }} />;

  const name = (
    <>
      <ShellTitle>{play.title}</ShellTitle>
      <Badge size="label" variant="outline" className="shrink-0">
        v{play.version}
      </Badge>
      {play.channel === "preview" ? (
        <Badge size="label" variant="secondary" className="shrink-0">
          PREVIEW
        </Badge>
      ) : null}
    </>
  );

  const actions = (
    <>
      <Popover>
        <PopoverTrigger
          disabled={sessionPending}
          render={<Button variant="ghost" size="icon" tooltip="Saves" aria-label="Saves" />}
        >
          <HugeiconsIcon icon={FloppyDiskIcon} size={16} />
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8} className="w-80">
          <SaveNotice
            mode={play.saveMode}
            connectOrigins={play.connectOrigins}
            signedIn={signedIn}
          />
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="icon"
        tooltip="Full screen"
        aria-label="Full screen"
        onClick={fullscreen}
      >
        <HugeiconsIcon icon={FullScreenIcon} size={16} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        tooltip="Game page"
        aria-label="Game page"
        nativeButton={false}
        render={gamePage}
      >
        <HugeiconsIcon icon={InformationCircleIcon} size={16} />
      </Button>
      {signedIn ? (
        <ReportDialog
          title="Report this game?"
          message={`Tell staff what's wrong with v${play.version}. Only staff see this.`}
          onSubmit={report}
        >
          <Button variant="ghost" size="icon" tooltip="Report" aria-label="Report">
            <HugeiconsIcon icon={Flag02Icon} size={16} />
          </Button>
        </ReportDialog>
      ) : null}
      {user ? (
        <SimpleTooltip content={`Signed in as ${user.name}`}>
          <span className="flex px-1">
            <UserAvatar avatarUrl={user.image} username={user.name} size={24} />
          </span>
        </SimpleTooltip>
      ) : (
        <SignInButton label={signInLabel(play.saveMode)} phone={phone} onClick={askSignIn} />
      )}
    </>
  );

  return (
    <CanvasShell
      phone={phone}
      topLeft={
        <SiteIsland
          label="Game"
          compact={phone}
          site={{
            back: { label: "game page", link: gamePage },
            signinSource: "game",
            onSignIn: askSignIn,
          }}
        >
          {name}
        </SiteIsland>
      }
      topRight={phone ? actions : <Island aria-label="Play">{actions}</Island>}
    >
      {sessionPending ? (
        <PlayLoading />
      ) : (
        <PlayFrame
          ref={iframeRef}
          frameUrl={play.frameUrl}
          title={play.title}
          release={{ id: play.release.id, gameId: play.release.gameId, projectId }}
          live={play.live}
          onReload={onReload}
          saveMode={play.saveMode}
          online={play.online}
          saves={stores.saves}
          describe={stores.describe}
          prefs={stores.prefs}
          player={() => ({ signedIn, name: user?.name ?? null })}
          dialogOpen={dialogOpen}
          onHostServer={(server) => {
            hostRef.current = server;
          }}
        />
      )}
      {signedIn ? null : (
        <SignInConfirm
          label={signInLabel(play.saveMode)}
          callbackURL={playPath(projectId, version)}
          open={signInAsked}
          onOpenChange={setSignInAsked}
        />
      )}
      {stores.site && signInId && play.saveMode === "site" && play.channel !== "preview" ? (
        <KeepSavesDialog
          projectId={projectId}
          gameId={play.release.gameId}
          title={play.title}
          signIn={signInId}
          local={stores.local}
          site={stores.site}
          onClaimed={() => hostRef.current?.notifySavesChanged()}
        />
      ) : null}
    </CanvasShell>
  );
}
