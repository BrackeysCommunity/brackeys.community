import { COLLAB_LAYOUT_VERSION } from "@jams/engine/collab";
import {
  ContentStoreError,
  hashForPut,
  isSha256,
  type CodeModuleInfo,
  type ContentStore,
  type ProjectBundle,
  type Sha256,
} from "@jams/engine/project";
import { SCENE_FORMAT_VERSION, type SceneIssue } from "@jams/engine/scene";

/** Where the CLI and the MCP server read the agent token when `--token` isn't given. */
export const AGENT_TOKEN_ENV = "JAMS_AGENT_TOKEN";
export const AGENT_SYNC_TOKEN_PATH = "/api/engine/agent-sync-token";
/** The longest a sync token lives; the site's answer can only shorten it. */
export const SYNC_TOKEN_TTL_MS = 60_000;
/** A held sync token is replaced this long before it expires. */
export const SYNC_TOKEN_REFRESH_MARGIN_MS = 15_000;
export const HOSTED_TIMEOUT_MS = 10_000;

export type HostedErrorCode =
  | "no-token"
  | "bad-url"
  | "invalid"
  | "expired"
  | "revoked"
  | "flag-off"
  | "forbidden"
  | "project-missing"
  | "wrong-project"
  | "rate-limited"
  | "not-configured"
  | "refused"
  | "unreachable"
  | "bad-response";

/** Why the site wouldn't trade the agent token for a sync token. Its message never holds the secret. */
export class HostedError extends Error {
  constructor(
    readonly code: HostedErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "HostedError";
  }
}

/** The agent token is past its expiry: a staff member mints a new one in the site. */
export class AgentTokenExpiredError extends HostedError {
  constructor(
    message = "The agent token has expired; create a new one in the site.",
    status = 401,
  ) {
    super("expired", message, status);
    this.name = "AgentTokenExpiredError";
  }
}

/** The agent token was revoked in the site. */
export class AgentTokenRevokedError extends HostedError {
  constructor(
    message = "The agent token was revoked; create a new one in the site.",
    status = 401,
  ) {
    super("revoked", message, status);
    this.name = "AgentTokenRevokedError";
  }
}

/** The `engine-projects` flag is off for the token's creator (or the site has no hosted projects). */
export class HostedProjectsOffError extends HostedError {
  constructor(
    message = "Hosted projects aren't enabled on this site for the agent token's creator.",
    status = 404,
  ) {
    super("flag-off", message, status);
    this.name = "HostedProjectsOffError";
  }
}

/** `--token` when given, else `JAMS_AGENT_TOKEN`; null when neither is set. */
export function agentTokenFrom(
  flag: string | true | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  if (flag === true) throw new HostedError("no-token", "--token needs a value.");
  const token = (flag ?? env[AGENT_TOKEN_ENV])?.trim();
  return token ? token : null;
}

/** Like `agentTokenFrom`, but a missing token is an error naming both places to put one. */
export function requireAgentToken(
  flag: string | true | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const token = agentTokenFrom(flag, env);
  if (!token) {
    throw new HostedError(
      "no-token",
      `A hosted project needs an agent token: pass --token or set ${AGENT_TOKEN_ENV}.`,
    );
  }
  return token;
}

export type HostedSyncToken = {
  /** The sync token: a credential too, valid for the project's docs until `expiresAt`. */
  token: string;
  /** The sync service's WebSocket URL. */
  url: string;
  access: "read" | "write";
  projectId: string;
  /** The agent token's id: the actor the docs' logs record. */
  agentId: string;
  /** The user the agent acts for (the token's `o` claim); null for a token that doesn't say. */
  onBehalfOf: string | null;
  /** Epoch ms by this machine's clock. */
  expiresAt: number;
};

export type AgentSyncTokensOptions = {
  /** The site's origin, `https://…` (a path is ignored). */
  site: string;
  agentToken: string;
  /** Refuses a token for any other project. */
  projectId?: string;
  formatVersion?: number;
  layoutVersion?: number;
  fetch?: typeof fetch;
  now?: () => number;
  marginMs?: number;
  timeoutMs?: number;
};

export type AgentSyncTokens = {
  /** A sync token valid for at least the margin, minting one when the held one is about to expire. */
  get(): Promise<HostedSyncToken>;
  /** Mints a new sync token whatever is held. */
  refresh(): Promise<HostedSyncToken>;
  /** `get()`'s token string, the shape a Hocuspocus provider's `token` option takes. */
  token(): Promise<string>;
};

/** The exchange endpoint on `site`. */
export function agentSyncTokenUrl(site: string): string {
  let url: URL;
  try {
    url = new URL(AGENT_SYNC_TOKEN_PATH, site);
  } catch {
    throw new HostedError("bad-url", `${JSON.stringify(site)} isn't a URL.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HostedError("bad-url", `The site URL must be http(s), not ${url.protocol}`);
  }
  return url.toString();
}

/** Answers about the agent token itself never change, so they are never asked twice. */
const FINAL_CODES: ReadonlySet<HostedErrorCode> = new Set([
  "invalid",
  "expired",
  "revoked",
  "wrong-project",
]);
const isFinal = (e: HostedError) => FINAL_CODES.has(e.code);

/**
 * Trades an agent token for 60 s project sync tokens and keeps one fresh:
 * the held token is replaced `marginMs` before it expires, concurrent asks
 * share one request, and a failed refresh falls back to the held token while
 * it is still valid. The agent token lives only in this closure and never
 * reaches an error message.
 */
export function createAgentSyncTokens(options: AgentSyncTokensOptions): AgentSyncTokens {
  const endpoint = agentSyncTokenUrl(options.site);
  const secret = options.agentToken.trim();
  if (!secret) {
    throw new HostedError(
      "no-token",
      `The agent token is empty: pass --token or set ${AGENT_TOKEN_ENV}.`,
    );
  }
  const doFetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const marginMs = options.marginMs ?? SYNC_TOKEN_REFRESH_MARGIN_MS;
  const timeoutMs = options.timeoutMs ?? HOSTED_TIMEOUT_MS;
  const body = JSON.stringify({
    formatVersion: options.formatVersion ?? SCENE_FORMAT_VERSION,
    layoutVersion: options.layoutVersion ?? COLLAB_LAYOUT_VERSION,
  });
  const redact = (text: string) => text.split(secret).join("[agent token]");

  let held: HostedSyncToken | null = null;
  let pending: Promise<HostedSyncToken> | null = null;
  let final: HostedError | null = null;

  async function exchange(): Promise<HostedSyncToken> {
    const askedAt = now();
    let response: Response;
    try {
      response = await doFetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new HostedError(
        "unreachable",
        redact(
          `Can't reach ${endpoint} (${error instanceof Error ? error.message : String(error)}).`,
        ),
      );
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw refusal(response.status, redact(messageOf(payload)));
    const grant = parseGrant(payload);
    if (!grant) {
      throw new HostedError(
        "bad-response",
        `${endpoint} answered ${response.status} without a sync token.`,
        response.status,
      );
    }
    if (options.projectId !== undefined && grant.projectId !== options.projectId) {
      throw new HostedError(
        "wrong-project",
        `The agent token is for project ${JSON.stringify(grant.projectId)}, not ${JSON.stringify(options.projectId)}.`,
      );
    }
    return {
      ...grant,
      onBehalfOf: syncTokenActor(grant.token)?.onBehalfOf ?? null,
      expiresAt: askedAt + lifetime(grant.expiresAt, response.headers.get("date")),
    };
  }

  function mint(): Promise<HostedSyncToken> {
    if (final) return Promise.reject(final);
    if (pending) return pending;
    const minting = exchange().then(
      (token) => {
        held = token;
        pending = null;
        return token;
      },
      (error: unknown) => {
        pending = null;
        if (error instanceof HostedError && isFinal(error)) {
          final = error;
          held = null;
        }
        throw error;
      },
    );
    pending = minting;
    return minting;
  }

  async function get(): Promise<HostedSyncToken> {
    const current = held;
    if (current && now() < current.expiresAt - marginMs) return current;
    try {
      return await mint();
    } catch (error) {
      if (current && !final && now() < current.expiresAt) return current;
      throw error;
    }
  }

  return {
    get,
    refresh: mint,
    token: () => get().then((t) => t.token),
  };
}

/**
 * How long the granted token lives, measured against the site's own clock
 * (`expiresAt - Date`) so a skewed local clock neither churns nor overstays;
 * never longer than the sync token TTL.
 */
function lifetime(expiresAt: number, dateHeader: string | null): number {
  const serverNow = dateHeader ? Date.parse(dateHeader) : Number.NaN;
  if (!Number.isFinite(serverNow)) return SYNC_TOKEN_TTL_MS;
  return Math.max(0, Math.min(SYNC_TOKEN_TTL_MS, expiresAt - serverNow));
}

function messageOf(payload: unknown): string {
  if (typeof payload === "object" && payload !== null) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

function refusal(status: number, message: string): HostedError {
  const said = message ? ` (${message})` : "";
  switch (status) {
    case 401:
      if (/\brevoked\b/i.test(message)) return new AgentTokenRevokedError(undefined, status);
      if (/\bexpired\b/i.test(message)) return new AgentTokenExpiredError(undefined, status);
      return new HostedError(
        "invalid",
        `The site doesn't know this agent token${said}; check --token or ${AGENT_TOKEN_ENV}.`,
        status,
      );
    case 403:
      return new HostedError("forbidden", `The site refused the agent token${said}.`, status);
    case 404:
      if (/\bproject\b/i.test(message)) {
        return new HostedError("project-missing", "The agent token's project was deleted.", status);
      }
      return new HostedProjectsOffError(undefined, status);
    case 429:
      return new HostedError(
        "rate-limited",
        `Too many sync tokens for this agent token${said}; try again later.`,
        status,
      );
    case 503:
      return new HostedError(
        "not-configured",
        `This site has no live sync service${said}.`,
        status,
      );
    default:
      return new HostedError("refused", `The site answered ${status}${said}.`, status);
  }
}

/** The route's answer, its `expiresAt` still by the site's clock. */
function parseGrant(payload: unknown): Omit<HostedSyncToken, "onBehalfOf"> | null {
  if (typeof payload !== "object" || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const { token, url, access, projectId, agentId, expiresAt } = p;
  if (
    typeof token !== "string" ||
    !token ||
    typeof url !== "string" ||
    !/^(?:wss?|https?):\/\/./.test(url) ||
    (access !== "read" && access !== "write") ||
    typeof projectId !== "string" ||
    typeof agentId !== "string" ||
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt)
  ) {
    return null;
  }
  return { token, url, access, projectId, agentId, expiresAt };
}

// ─── Hosted projects over HTTP ───────────────────────────

/** A site URL (`http(s)://…`): a hosted project, where a `ws(s)://` URL is a dev collab server. */
export function isHostedUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** The agent and user a sync token's `g` and `o` claims name; null for a token that carries none. */
export function syncTokenActor(token: string): { agentId: string; onBehalfOf: string } | null {
  const [payload] = token.split(".");
  if (!payload) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const { g, o } = (claims ?? {}) as { g?: unknown; o?: unknown };
  return typeof g === "string" && g && typeof o === "string" && o
    ? { agentId: g, onBehalfOf: o }
    : null;
}

export type HostedSiteOptions = {
  site: string;
  agentToken: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export type HostedSite = {
  /** The site's origin. */
  readonly origin: string;
  /**
   * A request to the site with the agent token as its bearer. A status
   * outside 2xx and `allow` becomes a `HostedError` that never holds the
   * secret; one in `allow` is the caller's to read.
   */
  request(
    path: string,
    init?: RequestInit & { allow?: readonly number[]; timeoutMs?: number },
  ): Promise<Response>;
};

/** The site's engine routes, called with an agent token: blobs and bundles of the token's project. */
export function hostedSite(options: HostedSiteOptions): HostedSite {
  let origin: string;
  try {
    origin = new URL(options.site).origin;
  } catch {
    throw new HostedError("bad-url", `${JSON.stringify(options.site)} isn't a URL.`);
  }
  if (!isHostedUrl(origin))
    throw new HostedError("bad-url", `The site URL must be http(s): ${options.site}`);
  const secret = options.agentToken.trim();
  if (!secret)
    throw new HostedError(
      "no-token",
      `The agent token is empty: pass --token or set ${AGENT_TOKEN_ENV}.`,
    );
  const doFetch = options.fetch ?? globalThis.fetch;
  const redact = (text: string) => text.split(secret).join("[agent token]");

  return {
    origin,
    async request(path, { allow = [], timeoutMs, headers, ...init } = {}) {
      const url = new URL(path, origin).toString();
      let response: Response;
      try {
        response = await doFetch(url, {
          ...init,
          headers: { ...(headers as Record<string, string>), authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(timeoutMs ?? options.timeoutMs ?? HOSTED_TIMEOUT_MS),
        });
      } catch (error) {
        throw new HostedError(
          "unreachable",
          redact(`Can't reach ${url} (${error instanceof Error ? error.message : String(error)}).`),
        );
      }
      if (response.ok || allow.includes(response.status)) return response;
      const payload: unknown = await response.json().catch(() => null);
      throw refusal(response.status, redact(messageOf(payload)));
    },
  };
}

/** `/api/engine/projects/<id><rest>`. */
export const engineProjectPath = (projectId: string, rest = "") =>
  `/api/engine/projects/${encodeURIComponent(projectId)}${rest}`;

/** What an upload names besides its bytes: its asset kind, which the site caps sizes by, and its type. */
export type BlobPutOptions = { kind?: string; contentType?: string };

const EXTENSION_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  ogg: "audio/ogg",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  json: "application/json",
  fnt: "text/plain",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
};

/** The content type a file is uploaded as: its extension's when its kind accepts it, else the kind's first. */
export function blobContentType(path: string, accepted: readonly string[]): string {
  const type = EXTENSION_TYPES[path.split(".").pop()?.toLowerCase() ?? ""];
  if (type && accepted.includes(type)) return type;
  return accepted[0] ?? "application/octet-stream";
}

/**
 * `store.put` with the upload's kind and type: the hosted store needs them,
 * and every other store takes the bytes alone and ignores them.
 */
export function putBlob(
  store: ContentStore,
  bytes: Uint8Array,
  opts: BlobPutOptions & { expect?: Sha256 } = {},
): Promise<Sha256> {
  const { expect, ...rest } = opts;
  const withOptions = store as {
    put(b: Uint8Array, e?: Sha256, o?: BlobPutOptions): Promise<Sha256>;
  };
  return withOptions.put(bytes, expect, rest);
}

/**
 * A hosted project's content store through the site's blob routes:
 * `GET`/`HEAD …/blobs/<sha256>` read (and are checked against their hash),
 * `POST …/blobs` uploads with `x-expect-sha256`. An upload needs its kind
 * (`putBlob`). A refusal that carries an issue (`hash-mismatch`,
 * `asset-too-large`, `quota-exceeded`) is a `ContentStoreError`.
 */
export function hostedContentStore(site: HostedSite, projectId: string): ContentStore {
  const blobPath = (hash?: Sha256) =>
    engineProjectPath(projectId, `/blobs${hash ? `/${hash}` : ""}`);
  return {
    async has(hash) {
      if (!isSha256(hash)) return false;
      const res = await site.request(blobPath(hash), { method: "HEAD", allow: [404] });
      return res.status !== 404;
    },
    async get(hash) {
      if (!isSha256(hash)) return null;
      const res = await site.request(blobPath(hash), { allow: [404] });
      if (res.status === 404) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      await hashForPut(bytes, hash);
      return bytes;
    },
    put: (async (bytes: Uint8Array, expect?: Sha256, opts: BlobPutOptions = {}) => {
      if (!opts.kind)
        throw new HostedError("refused", "A hosted upload names its asset kind (putBlob).");
      const hash = await hashForPut(bytes, expect);
      const res = await site.request(blobPath(), {
        method: "POST",
        body: new Uint8Array(bytes),
        headers: {
          "content-type": opts.contentType ?? "application/octet-stream",
          "x-asset-kind": opts.kind,
          "x-expect-sha256": hash,
        },
        allow: [400, 403, 409, 413, 422],
      });
      const body = (await res.json().catch(() => ({}))) as {
        sha256?: unknown;
        message?: unknown;
        issue?: SceneIssue;
      };
      if (body.issue) throw new ContentStoreError(body.issue);
      if (!res.ok || body.sha256 !== hash)
        throw new HostedError(
          "refused",
          `The site refused the upload (${res.status}${typeof body.message === "string" ? `: ${body.message}` : ""}).`,
          res.status,
        );
      return hash;
    }) as ContentStore["put"],
  };
}

/** One scene or asset doc of a hosted project, as `GET …/bundle` hands it out. */
export type HostedDoc = {
  prefix: "scene" | "asset";
  key: string;
  kind: string;
  /** Null until the service first loads the doc; `seed` is its file text meanwhile. */
  state: Uint8Array | null;
  seed: string | null;
};

/** A hosted project's registry, doc states and blob hashes: what `project pull` turns into files. */
export type HostedBundle = {
  projectId: string;
  name: string;
  game: string | null;
  project: Uint8Array;
  docs: HostedDoc[];
  blobs: { sha256: Sha256; bytes: number; contentType: string }[];
};

const fromBase64 = (text: string) => new Uint8Array(Buffer.from(text, "base64"));

/** The JSON `GET …/bundle` answers: Yjs states as base64. */
type HostedBundleWire = Omit<HostedBundle, "project" | "docs"> & {
  project: string;
  docs: (Omit<HostedDoc, "state"> & { state: string | null })[];
};

/** The site's `HostedProjectWire` read back; null for anything else. */
export function parseHostedBundle(payload: unknown): HostedBundle | null {
  const p = payload as Partial<HostedBundleWire> | null;
  if (
    !p ||
    typeof p.projectId !== "string" ||
    typeof p.name !== "string" ||
    typeof p.project !== "string" ||
    !Array.isArray(p.docs) ||
    !Array.isArray(p.blobs)
  )
    return null;
  const docs: HostedDoc[] = [];
  for (const d of p.docs) {
    if (
      !d ||
      (d.prefix !== "scene" && d.prefix !== "asset") ||
      typeof d.key !== "string" ||
      typeof d.kind !== "string" ||
      (d.state !== null && typeof d.state !== "string") ||
      (d.seed !== null && typeof d.seed !== "string")
    )
      return null;
    docs.push({
      prefix: d.prefix,
      key: d.key,
      kind: d.kind,
      state: d.state === null ? null : fromBase64(d.state),
      seed: d.seed,
    });
  }
  return {
    projectId: p.projectId,
    name: p.name,
    game: typeof p.game === "string" ? p.game : null,
    project: fromBase64(p.project),
    docs,
    blobs: p.blobs.filter((b) => isSha256(b?.sha256)),
  };
}

/** `GET …/bundle`: every doc state the service has stored and every blob hash. */
export async function fetchHostedBundle(
  site: HostedSite,
  projectId: string,
): Promise<HostedBundle> {
  const res = await site.request(engineProjectPath(projectId, "/bundle"), {
    headers: { accept: "application/json" },
  });
  const bundle = parseHostedBundle(await res.json().catch(() => null));
  if (!bundle || bundle.projectId !== projectId)
    throw new HostedError(
      "bad-response",
      `${site.origin} answered without project ${projectId}'s bundle.`,
      res.status,
    );
  return bundle;
}

export type SeedRefusal = {
  status: number;
  message: string;
  /** Per-file problems, for a bundle the site can't host as it is. */
  problems?: { path: string; issues: SceneIssue[] }[];
  issue?: SceneIssue;
};

/** `POST …/bundle`: seeds the project from a bundle; refused when the project holds anything already. */
export async function seedHostedBundle(
  site: HostedSite,
  projectId: string,
  body: { bundle: ProjectBundle; game: string | null; code: Record<string, CodeModuleInfo> },
): Promise<{ ok: true; docs: number; warnings: unknown[] } | ({ ok: false } & SeedRefusal)> {
  const res = await site.request(engineProjectPath(projectId, "/bundle"), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    allow: [400, 403, 409, 413],
  });
  const payload = (await res.json().catch(() => ({}))) as {
    docs?: unknown;
    warnings?: unknown;
    message?: unknown;
    problems?: SeedRefusal["problems"];
    issue?: SceneIssue;
  };
  if (res.ok)
    return {
      ok: true,
      docs: typeof payload.docs === "number" ? payload.docs : 0,
      warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
    };
  return {
    ok: false,
    status: res.status,
    message: typeof payload.message === "string" ? payload.message : `answered ${res.status}`,
    ...(payload.problems ? { problems: payload.problems } : {}),
    ...(payload.issue ? { issue: payload.issue } : {}),
  };
}
