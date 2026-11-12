import { Cancel01Icon, Download01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useEffectEvent, useRef, useState, type Ref } from "react";

import { Button } from "@/components/ui/button";
import { FRAME_ALLOW, FRAME_SANDBOX } from "@/lib/engine/frame-sandbox";
import {
  createHostServer,
  type HostServer,
  type HostServerOptions,
} from "@/lib/engine/host-server";
import { cn } from "@/lib/utils";

type DownloadOffer = { name: string; contentType: string; bytes: ArrayBuffer };

export type PlayFrameProps = {
  /** The release's `index.html` with `?host=jams`. */
  frameUrl: string;
  /** The game's title, the iframe's accessible name. */
  title: string;
  release: HostServerOptions["release"];
  saveMode: HostServerOptions["mode"];
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

const MIME = /^[\w.+-]+\/[\w.+-]+$/;

function safeFileName(name: string): string {
  // oxlint-disable-next-line no-control-regex -- strips control characters from a name the frame chose
  const cleaned = name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]+/g, "_").trim();
  return cleaned.replace(/^\.+/, "").slice(0, 128) || "recording";
}

function saveToDisk(offer: DownloadOffer): void {
  const type = MIME.test(offer.contentType) ? offer.contentType : "application/octet-stream";
  const url = URL.createObjectURL(new Blob([offer.bytes], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = safeFileName(offer.name);
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The sandboxed game frame and the play page's end of its host channel. */
export function PlayFrame({
  frameUrl,
  title,
  release,
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

  const { id: releaseId, gameId, projectId } = release;
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const server = createHostServer({
      iframe,
      release: { id: releaseId, gameId, projectId },
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
      onState: (s) => latest().onState?.(s),
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
    serverRef.current = server;
    pausedSentRef.current = false;
    syncPause();
    announce(server);
    return () => {
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
