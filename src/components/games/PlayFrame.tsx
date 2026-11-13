import { Cancel01Icon, Download01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { LiveSnapshot } from "@jams/engine/standalone";
import { useCallback, useEffect, useEffectEvent, useRef, useState, type Ref } from "react";

import { Button } from "@/components/ui/button";
import { downloadBlob } from "@/lib/download";
import { FRAME_ALLOW, FRAME_SANDBOX } from "@/lib/engine/frame-sandbox";
import {
  createHostServer,
  type HostServer,
  type HostServerOptions,
} from "@/lib/engine/host-server";
import { createLiveClient, type LiveClient } from "@/lib/engine/live-client";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type DownloadOffer = { name: string; contentType: string; bytes: ArrayBuffer };

export type PlayFrameProps = {
  /** The release's `index.html` with `?host=jams`. */
  frameUrl: string;
  /** The game's title, the iframe's accessible name. */
  title: string;
  release: HostServerOptions["release"];
  saveMode: HostServerOptions["mode"];
  /**
   * The play payload's live scenes: the frame starts on them and follows the
   * channel's changes. Null for a version number, which plays exactly its release.
   */
  live?: LiveSnapshot | null;
  /**
   * Loads the play payload again, for the channel's new release: the frame
   * reloads with the new URL, and a rejection offers Reload again. Without it
   * Reload reloads the whole page.
   */
  onReload?: () => Promise<unknown>;
  /** The project plays online, as the host channel's `welcome` tells the frame. */
  online?: boolean;
  saves: HostServerOptions["saves"];
  describe: HostServerOptions["describe"];
  prefs: HostServerOptions["prefs"];
  /** Who plays, as the frame's `welcome` says; signed out when absent. */
  player?: HostServerOptions["player"];
  /** True while the page's chrome has a dialog open over the game. */
  dialogOpen?: boolean;
  /** False ignores the frame's download offers, so no Download recording button shows. */
  offerDownloads?: boolean;
  onState?: HostServerOptions["onState"];
  sessionToken?: HostServerOptions["sessionToken"];
  /** The live host server, or null once disposed; the chrome calls `notifySavesChanged` after sign-in. */
  onHostServer?: (server: HostServer | null) => void;
  /** The iframe element, for the chrome's Fullscreen. */
  ref?: Ref<HTMLIFrameElement>;
  className?: string;
};

/** The quiet toast for a level swapped while the player plays it. */
export const LIVE_SWAP_TOAST = "This level was just updated.";
/** The channel moved to another release, which only a reload can play. */
export const liveReleaseToast = (title: string): string =>
  `A new version of ${title} is available.`;
/** While Reload fetches the new release. */
export const LIVE_RELEASE_LOADING = "Loading the new version…";
/** Reload couldn't fetch the new release; the game plays on as it was. */
export const liveReleaseFailedToast = (title: string): string =>
  `The new version of ${title} didn't load.`;
/** Shown as the frame reloads off a version staff hid. */
export const LIVE_REMOVED_NOTICE = "A level in this game was removed by moderators.";

const LIVE_RELEASE_TOAST_ID = "live-release-moved";

const MIME = /^[\w.+-]+\/[\w.+-]+$/;

function safeFileName(name: string): string {
  // oxlint-disable-next-line no-control-regex -- strips control characters from a name the frame chose
  const cleaned = name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, "_").trim();
  return cleaned.replace(/^\.+/, "").slice(0, 128) || "recording";
}

function saveToDisk(offer: DownloadOffer): void {
  const type = MIME.test(offer.contentType) ? offer.contentType : "application/octet-stream";
  downloadBlob(safeFileName(offer.name), new Blob([offer.bytes], { type }));
}

/**
 * The new-version toast's Reload: the toast turns into a pending one while the
 * play reloads, and offers Reload again if that fails. Nothing more shows once
 * the frame it belongs to has gone.
 */
function releaseReloadAction(
  current: () => { reload: (() => Promise<unknown>) | undefined; title: string },
  gone: () => boolean,
) {
  const action = {
    label: "Reload",
    onClick: (event: { preventDefault(): void }) => {
      const { reload, title } = current();
      if (!reload) {
        window.location.reload();
        return;
      }
      // Keeps the toast open: it becomes the pending state.
      event.preventDefault();
      toast.loading(LIVE_RELEASE_LOADING, {
        id: LIVE_RELEASE_TOAST_ID,
        duration: Number.POSITIVE_INFINITY,
        action: undefined,
      });
      reload().then(
        () => {
          if (!gone()) toast.dismiss(LIVE_RELEASE_TOAST_ID);
        },
        () => {
          if (gone()) return;
          toast.error(liveReleaseFailedToast(title), {
            id: LIVE_RELEASE_TOAST_ID,
            duration: Number.POSITIVE_INFINITY,
            action,
          });
        },
      );
    },
  };
  return action;
}

/** The sandboxed game frame and the play page's end of its host channel. */
export function PlayFrame({
  frameUrl,
  title,
  release,
  live = null,
  onReload,
  saveMode,
  online = false,
  saves,
  describe,
  prefs,
  player,
  dialogOpen = false,
  offerDownloads = true,
  onState,
  sessionToken,
  onHostServer,
  ref,
  className,
}: PlayFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const serverRef = useRef<HostServer | null>(null);
  const pausedSentRef = useRef(false);
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  const [offer, setOffer] = useState<DownloadOffer | null>(null);
  const paused = hidden || dialogOpen;

  // The server lives as long as the frame; it reads the latest props through these, so a re-render doesn't rebuild it.
  const latest = useEffectEvent(() => ({
    saves,
    describe,
    prefs,
    player,
    onState,
    sessionToken,
    offerDownloads,
    live,
    onReload,
    title,
  }));
  const announce = useEffectEvent((server: HostServer | null) => onHostServer?.(server));
  const syncPause = useEffectEvent(() => {
    const server = serverRef.current;
    if (!server || pausedSentRef.current === paused) return;
    pausedSentRef.current = paused;
    if (paused) server.pause();
    else server.resume();
  });

  const setIframe = useCallback(
    (el: HTMLIFrameElement | null) => {
      iframeRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );

  /** Loads the frame again in place: the host server stays and welcomes it with the latest live scenes. */
  const reloadFrame = useEffectEvent(() => {
    const iframe = iframeRef.current;
    if (iframe) iframe.src = frameUrl;
  });

  const { id: releaseId, gameId, projectId } = release;
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const initial = latest().live;
    let liveClient: LiveClient | null = null;
    let gone = false;
    const server = createHostServer({
      iframe,
      release: { id: releaseId, gameId, projectId },
      live: () => latest().live ?? null,
      saves: () => latest().saves(),
      describe: () => latest().describe(),
      mode: saveMode,
      online,
      prefs: {
        load: () => latest().prefs.load(),
        save: (store, value) => latest().prefs.save(store, value),
      },
      player: () => {
        const who = latest().player;
        return who ? who() : { signedIn: false, name: null };
      },
      onState: (s) => {
        liveClient?.frameState(s);
        latest().onState?.(s);
      },
      onDownload: (d) => {
        if (latest().offerDownloads) setOffer(d);
      },
      sessionToken:
        latest().sessionToken === undefined
          ? undefined
          : (sessionId) => {
              const fn = latest().sessionToken;
              return fn ? fn(sessionId) : Promise.reject(new Error("No session tokens here."));
            },
    });
    // Only `latest` and `preview` carry live scenes, and only over the release this frame runs.
    liveClient =
      initial && initial.release === releaseId
        ? createLiveClient({
            projectId,
            channel: initial.channel,
            initial,
            host: server,
            onSwapApplied: () => toast(LIVE_SWAP_TOAST),
            onReleaseMoved: () =>
              toast(liveReleaseToast(latest().title), {
                id: LIVE_RELEASE_TOAST_ID,
                duration: Number.POSITIVE_INFINITY,
                action: releaseReloadAction(
                  () => ({ reload: latest().onReload, title: latest().title }),
                  () => gone,
                ),
              }),
            onReleaseRestored: () => toast.dismiss(LIVE_RELEASE_TOAST_ID),
            onRemoved: () => {
              toast(LIVE_REMOVED_NOTICE);
              reloadFrame();
            },
          })
        : null;
    serverRef.current = server;
    pausedSentRef.current = false;
    syncPause();
    announce(server);
    return () => {
      liveClient?.dispose();
      gone = true;
      toast.dismiss(LIVE_RELEASE_TOAST_ID);
      serverRef.current = null;
      server.dispose();
      announce(null);
      setOffer(null);
    };
  }, [frameUrl, releaseId, gameId, projectId, saveMode, online]);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    syncPause();
  }, [paused]);

  const wasDialogOpen = useRef(dialogOpen);
  useEffect(() => {
    if (wasDialogOpen.current && !dialogOpen) iframeRef.current?.focus();
    wasDialogOpen.current = dialogOpen;
  }, [dialogOpen]);

  const focusFrame = useCallback(() => iframeRef.current?.focus(), []);

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- keyboard players tab into the iframe itself
    <div role="presentation" className={cn("relative size-full", className)} onClick={focusFrame}>
      <iframe
        ref={setIframe}
        src={frameUrl}
        sandbox={FRAME_SANDBOX}
        allow={FRAME_ALLOW}
        referrerPolicy="no-referrer"
        title={title}
        onLoad={focusFrame}
        className="block size-full border-0 bg-black"
      />
      {offer && offerDownloads ? (
        // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- keeps the offer's clicks from refocusing the frame
        <div className="absolute right-3 bottom-3 flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm"
            variant="secondary"
            tooltip={safeFileName(offer.name)}
            onClick={() => saveToDisk(offer)}
          >
            <HugeiconsIcon icon={Download01Icon} data-icon="inline-start" />
            Download recording
          </Button>
          <Button
            size="icon-sm"
            variant="secondary"
            tooltip="Dismiss"
            aria-label="Dismiss the recording"
            onClick={() => setOffer(null)}
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
