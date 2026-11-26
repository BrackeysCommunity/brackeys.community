import {
  Layers01Icon,
  Location01Icon,
  Login01Icon,
  Maximize01Icon,
  MinusSignIcon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";

import { CanvasShell, Island } from "@/components/canvas/shell/CanvasShell";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Heading, MicroLabel, Text } from "@/components/ui/typography";
import { UserAvatar } from "@/components/ui/user-avatar";
import { authClient, signInWithDiscord } from "@/lib/auth-client";
import { useIsHydrated } from "@/lib/hooks/use-is-hydrated";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import { SITE } from "@/lib/legal-meta";

import { type Axial, LAYERS, LIVE_LAYERS } from "../../../packages/mmo-map/src/index.ts";
import { mapAlt } from "../../../packages/mmo-words/src/alt.ts";
import { MAP_LAYER_NAMES, plural } from "../../../packages/mmo-words/src/index.ts";
import { MapCanvas, type MapCanvasHandle } from "./MapCanvas";
import { MapLayers } from "./MapLayers";
import { MapStatus } from "./MapStatus";
import { type TileContext, TilePanel } from "./TilePanel";
import {
  cellIndex,
  countInView,
  type LiveMap,
  mapNames,
  type MapSearch,
  type MapViewer,
  tileAt,
  useLiveMap,
} from "./use-live-map";

// structural: one press of a zoom button.
const ZOOM_STEP = 1.5;

interface SignedInUser {
  name?: string | null;
  image?: string | null;
}

function ViewerIsland({
  user,
  viewer,
  compact,
  onHome,
}: {
  user: SignedInUser | null | undefined;
  viewer: MapViewer;
  compact: boolean;
  onHome: () => void;
}) {
  if (user === undefined) return <Skeleton className="h-7 w-28" />;
  if (!user) {
    return (
      <Button size="sm" variant="outline" onClick={() => void signInWithDiscord("map")}>
        <HugeiconsIcon icon={Login01Icon} size={14} />
        {compact ? "Sign in" : "Sign in with Discord"}
      </Button>
    );
  }
  const character = viewer === "character";
  return (
    <span className="flex items-center gap-2 px-1">
      <UserAvatar avatarUrl={user.image} username={user.name} size={24} />
      {compact ? null : (
        <span className="flex min-w-0 flex-col">
          <Text as="span" size="sm" ellipsis>
            {user.name}
          </Text>
          <MicroLabel as="span">
            {character ? "Your character is on the map" : "No character in the world yet"}
          </MicroLabel>
        </span>
      )}
      {character ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back to your character"
          tooltip="Back to your character"
          onClick={onHome}
        >
          <HugeiconsIcon icon={Location01Icon} size={14} />
        </Button>
      ) : null}
    </span>
  );
}

function ZoomButtons({ canvas }: { canvas: React.RefObject<MapCanvasHandle | null> }) {
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Zoom in"
        tooltip="Zoom in"
        onClick={() => canvas.current?.zoomBy(ZOOM_STEP)}
      >
        <HugeiconsIcon icon={PlusSignIcon} size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Zoom out"
        tooltip="Zoom out"
        onClick={() => canvas.current?.zoomBy(1 / ZOOM_STEP)}
      >
        <HugeiconsIcon icon={MinusSignIcon} size={14} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Fit the world"
        tooltip="Fit the world"
        onClick={() => canvas.current?.fit()}
      >
        <HugeiconsIcon icon={Maximize01Icon} size={14} />
      </Button>
    </>
  );
}

/** The canvas's text alternative: what it shows, and where the viewer stands. */
function altOf(map: LiveMap, seen: number): string {
  if (!map.index) return mapAlt({ of: "the wasteland, not drawn yet" });
  const parts = LAYERS.filter((l) => map.layers.has(l) && !LIVE_LAYERS.includes(l)).map((l) =>
    (MAP_LAYER_NAMES[l] ?? l).toLowerCase(),
  );
  const live = map.viewer === "character";
  const shaded = live
    ? [
        "what you have in sight, rimmed",
        ...LIVE_LAYERS.filter((l) => l !== "self" && map.layers.has(l)).map((l) =>
          (MAP_LAYER_NAMES[l] ?? l).toLowerCase(),
        ),
      ]
    : [];
  return mapAlt({
    of: `the wasteland as it has been found, ${plural(map.index.tiles, "tile")}`,
    parts,
    you: live && map.overlay?.self && map.layers.has("self") ? "the ringed tile" : undefined,
    shaded,
    seen: live ? seen : 0,
  });
}

/** A phone's panel, over the map: a tap beside it puts it away. */
function Sheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="relative flex w-full flex-col justify-end p-2">
      <button
        type="button"
        aria-label="Back to the map"
        className="absolute inset-0 bg-background/40"
        onClick={onClose}
      />
      <div className="relative max-h-[70%] overflow-y-auto">{children}</div>
    </div>
  );
}

/**
 * The live map, taking over the window (GDD 4.11): the discovered world
 * from the shared base, and for a signed-in character what they and their
 * guild have in sight or last saw. The world filters; this page draws.
 */
export function MapPage({ search }: { search: MapSearch }) {
  const phone = useIsMobile();
  const { data: session, isPending } = authClient.useSession();
  // The server never knows the session here, so the first paint waits for it either way.
  const hydrated = useIsHydrated();
  const user = isPending || !hydrated ? undefined : (session?.user ?? null);
  const map = useLiveMap({ search, userId: user === undefined ? undefined : (user?.id ?? null) });
  const canvas = useRef<MapCanvasHandle>(null);
  const [picked, setPicked] = useState<Axial | undefined>(undefined);
  const [layersOpen, setLayersOpen] = useState(false);

  const { chunks, regions, overlay } = map;
  const cells = useMemo(() => cellIndex(chunks, regions), [chunks, regions]);
  const names = useMemo(() => mapNames(regions, chunks, overlay), [chunks, regions, overlay]);
  const at: TileContext = {
    tick: overlay?.tick ?? map.index?.tick ?? 0,
    names,
    self: map.viewer === "character" ? overlay?.self : undefined,
  };
  const counts =
    map.index && map.style && map.camera && map.view
      ? countInView(
          { index: map.index, style: map.style, regions, chunks, overlay },
          map.camera,
          map.view,
        )
      : undefined;
  const pickedTile = picked ? tileAt(picked, cells, overlay) : undefined;
  const home = () => {
    if (overlay?.self) canvas.current?.goTo(overlay.self);
  };
  const pick = (h: Axial | undefined) => {
    setPicked(h);
    if (h) setLayersOpen(false);
  };

  const title = (
    <>
      <Link
        to="/"
        aria-label={`${SITE.name} home`}
        className="flex items-center rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <BrandMark className="h-5 w-5" />
      </Link>
      <span className="flex min-w-0 flex-col">
        <Heading as="h1" size="sm" ellipsis>
          Live map
        </Heading>
        {map.index && !phone ? (
          <MicroLabel as="span">{plural(map.index.tiles, "tile")} found</MicroLabel>
        ) : null}
      </span>
    </>
  );
  const layers = (
    <MapLayers
      layers={map.layers}
      onChange={map.setLayers}
      viewer={map.viewer}
      className={phone ? "w-full" : undefined}
    />
  );
  const tile = picked ? (
    <TilePanel tile={pickedTile} at={at} onClose={() => setPicked(undefined)} />
  ) : null;
  const viewer = <ViewerIsland user={user} viewer={map.viewer} compact={phone} onHome={home} />;
  const status = <MapStatus index={map.index} counts={counts} problem={map.problem} />;

  const document = (
    <>
      <MapCanvas
        ref={canvas}
        map={map}
        picked={picked}
        onPick={pick}
        at={at}
        label={altOf(map, counts?.seen ?? 0)}
      />
      {map.loading ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-busy>
          <Skeleton className="aspect-square w-2/3 max-w-xl rounded-full opacity-60" />
        </div>
      ) : null}
    </>
  );

  if (phone) {
    return (
      <CanvasShell
        phone
        topLeft={title}
        topRight={
          <>
            <Button
              variant={layersOpen ? "secondary" : "ghost"}
              size="icon-sm"
              aria-label="Layers"
              aria-pressed={layersOpen}
              tooltip="Layers"
              onClick={() => setLayersOpen((open) => !open)}
            >
              <HugeiconsIcon icon={Layers01Icon} size={16} />
            </Button>
            {viewer}
          </>
        }
        left={
          layersOpen ? (
            <Sheet onClose={() => setLayersOpen(false)}>{layers}</Sheet>
          ) : tile ? (
            <Sheet onClose={() => setPicked(undefined)}>{tile}</Sheet>
          ) : null
        }
        dock={<ZoomButtons canvas={canvas} />}
        status={<span role="status">{status}</span>}
      >
        {document}
      </CanvasShell>
    );
  }

  return (
    <CanvasShell
      topLeft={<Island className="gap-1.5 pr-3">{title}</Island>}
      topRight={<Island aria-label="You">{viewer}</Island>}
      left={layers}
      right={tile}
      dock={
        <Island aria-label="Zoom">
          <ZoomButtons canvas={canvas} />
        </Island>
      }
      status={
        <Island role="status" aria-live="polite" className="px-2.5 py-1.5">
          {status}
        </Island>
      }
    >
      {document}
    </CanvasShell>
  );
}
