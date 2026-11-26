import "@fontsource-variable/rubik";
import "./styles.css";
import type { TokenReply, TokenRequest } from "./api.ts";
import { App, type AppOptions } from "./app.ts";
import { beacon, beaconAs, startBeacon } from "./beacon.ts";
import { launch, routes, SignInError } from "./discord.ts";
import { liveSource, mockSource } from "./map/source.ts";
import { Session, type SessionDeps, type SocketLike } from "./session.ts";
import { theme } from "./theme.ts";

// Monotonic, so a step in the device's wall clock leaves the server offset good.
const monotonic = () => performance.timeOrigin + performance.now();

const after = (ms: number, f: () => void) => {
  const t = setTimeout(f, ms);
  return () => clearTimeout(t);
};

// An intent's id. randomUUID needs a secure context, which a phone on the
// local network does not have.
function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// A phone's caps apply where the pointer is a finger or the screen is narrow.
function isCompact(): boolean {
  return matchMedia("(pointer: coarse)").matches || innerWidth < 600;
}

async function token(url: string, req: TokenRequest): Promise<TokenReply> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (res.status === 401)
    throw new SignInError(
      "Discord would not sign you in. Close this and open it again from a card.",
    );
  if (res.status === 404)
    throw new SignInError("This world does not take a named player. Open this from Discord.");
  if (res.status === 400)
    throw new SignInError("The sign-in was not understood. Close this and open it again.");
  if (!res.ok) throw new Error("the world is not answering yet");
  return res.json();
}

/** A page's session and what its App is opened with. */
interface Boot {
  deps: SessionDeps;
  app: AppOptions;
}

// The mock ships in the build and is loaded only when the address asks.
// ?mock=beat&family=crank&level=6&practice=8 puts any family on the beat.
// ?mock=party&seats=4 seats a party of four, three of them played by
// script; party-machine, floor and hunt work the same way. ?mock=map opens
// on the map; every mock's Map screen draws the map fixtures.
async function mocked(fixture: string, compact: boolean, query: URLSearchParams): Promise<Boot> {
  const states = import.meta.glob<{ default: import("./api.ts").ActivityState }>(
    "../test/fixtures/state-*.json",
  );
  const { mockScene, mapFixtures, MockGateway } = await import("./mock.ts");
  const scene = mockScene(fixture);
  const load = states[`../test/fixtures/state-${scene.state}.json`];
  if (!load) {
    const known = Object.keys(states).map((p) => p.replace(/^.*state-(.*)\.json$/, "$1"));
    throw new SignInError(
      `There is no mock called ${fixture}. Try one of: ${[...known, "map"].join(", ")}.`,
    );
  }
  const [rigs, partyRigs, state, map] = await Promise.all([
    import("virtual:rigs"),
    import("virtual:party-rigs"),
    load(),
    mapFixtures(query),
  ]);
  const st = structuredClone(state.default);
  const family = query.get("family");
  if (family && st.fight) {
    st.fight.machine = family;
    st.machine = undefined;
    st.character.practice = [{ id: family, level: Number(query.get("practice") ?? 0) }];
  }
  const gateway = new MockGateway({
    state: st,
    rigs: rigs.default,
    level: Number(query.get("level") ?? 1),
    now: Date.now,
    after,
    partyRigs: partyRigs.default,
    seats: query.has("seats") ? Number(query.get("seats")) : undefined,
    teammates: true,
  });
  return {
    deps: {
      signIn: async () => ({ dev: "mock" }),
      token: () => gateway.token(),
      open: () => gateway.open(),
      instance: "mock",
      viewer: { compact },
      now: monotonic,
      after,
      id: newId,
    },
    app: { map: mockSource(map), open: scene.open },
  };
}

async function live(compact: boolean): Promise<Boot> {
  const r = routes(location);
  startBeacon(r.log);
  beacon("boot");
  const clientId =
    document.querySelector<HTMLMetaElement>('meta[name="discord-client-id"]')?.content ?? "";
  const l = await launch(location, clientId);
  beacon("ready", { instance: l.instance, platform: l.platform, inDiscord: l.inDiscord });
  // Every map read is asked as the newest session the sign-in gave.
  let bearer = "";
  return {
    deps: {
      signIn: () => l.signIn(),
      token: async (req) => {
        const reply = await token(r.token, req);
        bearer = reply.session;
        beaconAs(reply.session);
        return reply;
      },
      open: () => new WebSocket(r.socket) as SocketLike,
      instance: l.instance,
      viewer: { compact },
      now: monotonic,
      after,
      id: newId,
      note: (kind, data) => beacon(kind, { instance: l.instance, platform: l.platform, ...data }),
    },
    app: { map: liveSource({ bearer: () => bearer }) },
  };
}

async function main(): Promise<void> {
  const root = document.querySelector<HTMLElement>("#app")!;
  theme(document.documentElement);
  const compact = isCompact();
  document.documentElement.classList.toggle("compact", compact);
  const query = new URLSearchParams(location.search);
  const mock = query.get("mock");
  const boot = await (mock ? mocked(mock, compact, query) : live(compact));
  const session = new Session(boot.deps);
  new App(root, session, compact, boot.app);
  session.start();
}

main().catch((err: unknown) => {
  const root = document.querySelector<HTMLElement>("#app");
  if (root) root.textContent = err instanceof Error ? err.message : "The Activity could not start.";
  beacon("error", { error: String(err) });
});
