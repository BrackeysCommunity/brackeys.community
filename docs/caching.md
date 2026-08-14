# HTTP caching

How responses are cached, from browser to Cloudflare edge to the Railway
origin. Origin headers are the source of truth — Cloudflare is configured to
respect them — so the policy lives in code (`vite.config.ts` → `routeRules`)
and survives zone migrations.

## Origin policy (implemented in `vite.config.ts`)

| Path                        | Cache-Control                                                    | Why                                                                                                                                                             |
| --------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/assets/**`                | `public, max-age=31536000, immutable`                            | Content-hashed bundles; URL changes on every deploy. Cloudflare edge-caches these.                                                                              |
| files in `public/`          | `public, max-age=86400, stale-while-revalidate=604800`           | Unhashed, root-served (logos, favicon, manifest, robots). Rules are generated from the directory listing at build time, so new files are covered automatically. |
| `/api/**`                   | `no-store`                                                       | Per-user JSON (oRPC, better-auth, uploads).                                                                                                                     |
| `/api/public/**`            | `no-store`, then `public, max-age=0, s-maxage=<n>` per procedure | The public RPC tier — GET, no cookies read, identical response for every caller. Caching is opt-in per procedure; see the section below.                        |
| `/images/**`                | `public, max-age=31536000, immutable`                            | Stable proxy for MinIO uploads (`src/routes/images.$.ts`). Keys are nanoid-unique per upload; replacements mint a new key, so URLs never change content.        |
| `/api/notifications/stream` | `no-cache, no-transform`                                         | SSE; `no-transform` keeps proxies from buffering the stream.                                                                                                    |
| `/**` (SSR documents)       | `private, no-cache`                                              | Pages embed the viewer's session, so shared caches must never hold them. `no-cache` (vs `no-store`) still allows browser revalidation and bfcache.              |

Two Nitro/h3 sharp edges encoded in the config comments:

- Route-rule headers **override** headers set by route handlers on 2xx
  responses (h3 merges rule headers last). That's why the SSE stream has its
  own rule restating the handler's header rather than inheriting `/api/**`'s
  `no-store`.
- Overlapping patterns merge with the **most specific pattern winning**
  (`/assets/**` beats `/**`), so the catch-all is safe.

Non-2xx responses don't get rule headers; Nitro's error handler emits
`no-cache` on JSON errors and Cloudflare doesn't cache error statuses by
default.

## Cloudflare (zones: brackeys.community, brackeys.dev)

Recommended dashboard state — origin headers do the real work; these settings
just make the edge honor them:

1. **Caching → Configuration → Browser Cache TTL: "Respect Existing
   Headers".** Otherwise Cloudflare rewrites browser TTLs (it was stamping
   its 4-hour default onto un-headered statics before the origin rules
   existed).
2. **Caching → Tiered Cache → Smart Tiered Caching: On.** Free, one toggle;
   cache misses funnel through one upper-tier POP instead of every POP
   hitting Railway.
3. **Optional Cache Rule — cache the non-default extensions:** Cloudflare's
   default cacheable-extension list covers `.js .css .svg .ico .png` but not
   `.json`/`.txt`, so `manifest.json` and `robots.txt` currently pass through
   to origin (`cf-cache-status: DYNAMIC`). If it's worth a rule slot:
   `(http.request.uri.path in {"/manifest.json" "/robots.txt"})` → Eligible
   for cache, respect origin TTL.
4. **Optional Cache Rule — bypass `/api/*`:** belt-and-braces; origin already
   says `no-store` and Cloudflare wouldn't cache these paths anyway.
5. **Never add a blanket "Cache Everything" rule** (or an Edge TTL
   "Override origin" on HTML) — documents are session-personalized. If
   anonymous-HTML edge caching is ever wanted, it needs a rule that bypasses
   on the better-auth session cookie.
6. Image Transformations are already enabled on brackeys.community
   (`/cdn-cgi/image/…` — see `src/lib/itch-image.ts`); transformed variants
   are cached at the edge by Cloudflare automatically.

Caveats:

- Cloudflare **ignores `stale-while-revalidate`** — it's for browsers. Edge
  TTL comes from `s-maxage`/`max-age`.
- Swapping a `public/` file in place can be stale at the edge for up to a
  day; purge the zone cache (or purge by URL) after changing one.

## Verifying

Against a build (`vp build`, then run `.output/server/index.mjs`):

```bash
curl -s -D - -o /dev/null http://127.0.0.1:3000/ | grep -i cache-control
```

Against an environment, also watch `cf-cache-status` (`HIT`/`MISS` = edge
cached, `DYNAMIC` = passed through):

```bash
curl -sI https://staging.brackeys.dev/assets/<hashed>.js | grep -iE 'cache-control|cf-cache-status'
```

## Uploaded images (`/images/<key>`)

Uploads (project covers, team avatars, collab post images) used to be read
via MinIO presigned URLs, whose signature rotated on every response —
browsers re-downloaded images they already had, and nothing could edge-cache
them. They now resolve to the stable `/images/<object key>` proxy
(`src/routes/images.$.ts`), which streams from the private bucket but only
for keys under the three upload namespaces (`profile-projects/`,
`team-avatars/`, `project-images/`).

- Responses are immutable (see table above): every upload mints a
  nanoid-unique key and replacement deletes the old object, so a URL's
  content can never change.
- These URLs are also **transform-eligible**: `src/lib/itch-image.ts`
  rewrites them to `/cdn-cgi/image/<options>/images/<key>` when
  `VITE_CF_IMAGES` is set, same as itch banners — AVIF/WebP re-encode,
  display-size variants, cached at the Cloudflare edge.
- **Deletion caveat:** a deleted object (replaced cover, deleted account)
  can outlive deletion in caches until evicted — up to the TTL in browsers
  that already have it, and at the edge until Cloudflare evicts it. If that
  ever matters, purge the URL (and its `/cdn-cgi/image/` variants) in the
  zone, or shorten the edge TTL with `s-maxage`.

## The public API tier (`/api/public/rpc/*`)

`/api/**` stays `no-store`: those responses derive from the session cookie
and oRPC's default RPC transport is POST, never edge-cacheable. The one
exception is the public tier (`src/routes/api.public.rpc.$.ts`), whose
contract is _the same response for everyone_.

Membership is `src/orpc/router/public.ts` — the same procedure instances the
root router exports, so the two tiers can never drift apart in behaviour.
Three independent guards keep session data out of the shared cache:

1. **No auth middleware** on any member (asserted by
   `src/orpc/router/__tests__/public-router.test.ts`).
2. **A cookie-free context** at the mount: request headers are dropped
   rather than forwarded, so a procedure that regrew a session lookup would
   still resolve anonymous.
3. **No session ⇒ no `Set-Cookie`**, and Cloudflare refuses to cache
   `Set-Cookie` responses regardless.

Mechanics worth knowing:

- Every member carries `.route({ method: "GET" })`, which
  `StrictGetMethodPlugin` requires before it will serve over GET. The
  attribute is inert on the private POST mount.
- The client (`src/orpc/client.ts`) dispatches by procedure name across two
  `RPCLink`s. Query keys derive from the property path, so call sites and
  TanStack Query keys are unchanged.
- RPC GET encodes input in the query string, which is part of Cloudflare's
  cache key by default — that is what keys per-input responses.
- Oversized inputs fall back to POST (still correct, just a cache miss).
- `resolveProjectForGame` is excluded: it mints a project row on first read,
  and a side effect behind a cacheable GET silently stops happening.

### TTLs: `max-age=0` everywhere, `s-maxage` does the work

Every rule on this tier is `public, max-age=0, s-maxage=<n>`, generated from
`PUBLIC_EDGE_TTL` in `src/orpc/public-procedures.ts` — `vite.config.ts`
spreads `publicCacheRouteRules()` rather than listing paths by hand, so the
config cannot drift from the table.

**Why no browser cache at all.** `max-age` governs the browser, and a browser
serving a stored copy answers a `fetch` without any request leaving the
machine. That silently defeats `invalidateQueries`, which is what the app
uses to show someone their own write: TanStack drops its entry, refetches,
and the browser hands back the pre-write body. `s-maxage` governs Cloudflare,
which is where the origin protection actually comes from — so the edge keeps
the real TTL and the browser always revalidates. The cost is close to nothing
because TanStack's own `staleTime` (15 s–5 min) already prevents refetch
spam.

This bit us once in the sketch: `listSkills`/`listCollabRoles` were
`max-age=3600, s-maxage=86400` on the reasoning that taxonomies are
near-static. But `/admin` invalidates exactly those two after a vocabulary
edit, and `approveSkillRequest` leaves a member waiting on the result — so
the editor's own browser would have shown the stale list for an hour, and
everyone else for a day. **Pick a TTL by asking "how stale may this look to
someone who did _not_ make the change?", not "how often does it change".**

Current budgets: jam archive 300 s (scraper-written, nobody waits on it);
member/team/project listings 60 s; detail pages (`getProfile`, `getTeam`,
`getProject`) and the whole collab board (`listPosts`, `getPost`, and the
counters beside them) 30 s; taxonomies 300 s; `getContributions` 900 s.

The catch-all `/api/public/**` is **`no-store`**, so caching is opt-in per
procedure: a public read that ships before someone picks its budget is merely
uncached, never cached for a duration nobody chose. `PUBLIC_EDGE_TTL` is
typed as a total `Record<PublicProcedureName, number>`, so omitting one is a
compile error, and `__tests__/public-router.test.ts` asserts the generated
rules cover every procedure and never carry a non-zero `max-age`.

**What `max-age=0` does not buy.** It guarantees the request leaves the
browser, not that the answer is fresh — Cloudflare still serves its copy for
`s-maxage` seconds. Edge staleness is a separate, deliberate choice — for
everyone except the writer. Purging it on write is mostly unavailable to us:
purge-by-prefix and purge-by-tag are Enterprise-only, and RPC GET URLs embed
the input in the query string, so purge-by-URL only works for procedures
called with one fixed input (`listSkills`, `listCollabRoles`, `getBoardStats`,
`getTeamStats`). If long taxonomy TTLs ever become worth it again, that is
the route.

**Writer-sees-own-write: the recent-write bypass.** The one reader `s-maxage`
must never serve stale is the person who just wrote — they upload a cover or
create a post, the app invalidates and refetches, and the edge answers with
the pre-write body (this shipped as a real bug the day the Cache Rule went
live: uploaded images "not appearing" until a manual refresh). The fix is
client-side, in `src/orpc/recent-write.ts` + `src/orpc/client.ts`: every
successful write stamps a 45 s window (30 s max TTL + headroom) during which
the client Proxy routes public procedures through the private `no-store`
mount — same procedure instances, origin-fresh, only for that browser.
Writes are recognized three ways: any oRPC call whose name doesn't follow
the get/list/count/search read convention (an `apply` trap on the client
Proxy — the naming convention is load-bearing), any successful `useMutation`
(a global `MutationCache` callback in
`src/integrations/tanstack-query/root-provider.tsx`, which covers mutations
whose write is a raw `fetch` to an upload endpoint), and an explicit
`markWrite()` in the one flow that is neither (the project cover control in
`ProjectHero`).

**The edge Cache Rule is in place and hitting** (2026-08-13): a Cache Rule
`starts_with(http.request.uri.path, "/api/public/")` → _Eligible for cache,
respect origin TTL_. It is load-bearing — JSON paths are not cacheable by
extension default, so without it the tier serves `cf-cache-status: DYNAMIC`
and the origin absorbs every read. If cache behaviour ever looks wrong, check
that the rule still exists before suspecting headers. Re-verify with: a second
`curl` of `/api/public/rpc/listJams?…` shows `HIT`; a request carrying a
session cookie returns the same cached object; `/api/rpc/*` still says
`no-store`.

Never mix authenticated and anonymous responses on one URL: Cloudflare
ignores `Vary` for cache keying, so split by URL. A future CLI's
token-authenticated calls stay under the `no-store` umbrella.

## Fonts (`src/fonts.css`)

Rubik, Space Grotesk and JetBrains Mono are self-hosted through Fontsource
(`@fontsource-variable/*`), so the woff2 files ride the hashed `/assets/**`
pipeline — immutable, edge-cached, no third-party connection on first paint.
They used to come from Google's CDN, which is a cache dead end regardless of
headers: browsers partition the HTTP cache per top-level site, so a visitor
who already had these fonts from another site re-downloaded them here.

- Each package's `index.css` carries the full upright weight axis split by
  `unicode-range`; a subset only downloads if the page renders a character in
  it. The families are named `… Variable` (`--font-sans` etc. in the same
  file).
- `src/routes/__root.tsx` preloads the three latin subsets. Fonts are only
  discoverable after the stylesheet parses, so without the hint the first
  paint lands in the fallback face and reflows.
- Adding a weight is free (one variable axis, no new request); adding a
  _family_ means a new package plus a preload decision.

## Known gaps / future levers

- **Anonymous HTML edge caching** (Cache Rule with cookie bypass) is possible
  later if logged-out landing traffic ever matters.
