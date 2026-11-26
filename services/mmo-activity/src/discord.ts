import {
  PathActivityLog,
  PathActivityMapChunk,
  PathActivityMapOverlay,
  PathActivityMapRegions,
  PathActivityMapStyle,
  PathActivityMapTick,
  PathActivitySocket,
  PathActivityToken,
  type TokenRequest,
} from "./api.ts";

/** Where the page was opened, and how it signs in. */
export interface Launch {
  inDiscord: boolean;
  /** The Activity instance: one per channel inside Discord, `dev` outside. */
  instance: string;
  platform: string;
  /** What sign-in trades for a session: Discord's code, or a named user on a local world. */
  signIn(): Promise<TokenRequest>;
}

export interface Routes {
  token: string;
  socket: string;
  log: string;
}

type Where = Pick<Location, "search" | "origin" | "host" | "protocol">;

/** Discord opens an Activity with its frame id in the query. */
export function inDiscord(where: Pick<Location, "search">): boolean {
  return new URLSearchParams(where.search).has("frame_id");
}

/** The listener's origin, with Discord's /.proxy in front when inside Discord. */
function base(where: Pick<Location, "search" | "origin">): string {
  return `${where.origin}${inDiscord(where) ? "/.proxy" : ""}`;
}

/**
 * The listener's routes, built from where the page is. Discord's proxy
 * puts /.proxy in front of everything an Activity fetches.
 */
export function routes(where: Where): Routes {
  const prefix = inDiscord(where) ? "/.proxy" : "";
  const ws = where.protocol === "https:" ? "wss:" : "ws:";
  return {
    token: base(where) + PathActivityToken,
    socket: `${ws}//${where.host}${prefix}${PathActivitySocket}`,
    log: base(where) + PathActivityLog,
  };
}

/** The live map's reads on the same listener (GDD 4.11). */
export interface MapRoutes {
  tick: string;
  style: string;
  regions: string;
  chunk: string;
  overlay: string;
}

export function mapRoutes(where: Pick<Location, "search" | "origin">): MapRoutes {
  const b = base(where);
  return {
    tick: b + PathActivityMapTick,
    style: b + PathActivityMapStyle,
    regions: b + PathActivityMapRegions,
    chunk: b + PathActivityMapChunk,
    overlay: b + PathActivityMapOverlay,
  };
}

/**
 * Starts the Embedded App SDK inside Discord. Outside it there is no SDK:
 * `?as=<discord id>` names the player, which only a local world with dev
 * sign-in on accepts.
 */
export async function launch(where: Pick<Location, "search">, clientId: string): Promise<Launch> {
  if (!inDiscord(where)) {
    const as = new URLSearchParams(where.search).get("as") ?? "";
    return {
      inDiscord: false,
      instance: "dev",
      platform: "browser",
      signIn: async () => {
        if (!as)
          throw new SignInError(
            "Open this from Discord, or name a player with ?as= on a local world.",
          );
        return { dev: as };
      },
    };
  }
  const { DiscordSDK } = await import("@discord/embedded-app-sdk");
  const sdk = new DiscordSDK(clientId);
  await sdk.ready();
  return {
    inDiscord: true,
    instance: sdk.instanceId,
    platform: sdk.platform,
    signIn: async () => {
      try {
        const { code } = await sdk.commands.authorize({
          client_id: clientId,
          response_type: "code",
          state: "",
          prompt: "none",
          scope: ["identify"],
        });
        return { code };
      } catch {
        throw new SignInError("Discord did not let this Activity sign you in.");
      }
    },
  };
}

/** A sign-in that will not work by trying again. */
export class SignInError extends Error {}
