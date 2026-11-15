import { byCodeUnit } from "../project/kinds/define";
import {
  CREDITS_FILE,
  INDEX_HTML_FILE,
  RELEASE_FILE,
  SERVICE_WORKER_FILE,
  WEB_MANIFEST_FILE,
  type ReleaseManifest,
} from "../project/release";

/** `jams-<project>-`: every cache a build of this project names starts with it, followed by two 12-hex hashes. */
export const serviceWorkerCachePrefix = (m: ReleaseManifest): string => `jams-${m.project.id}-`;

/** `jams-<project>-<build.hash 12>-<snapshot 12>`: a new build or new content is a new cache. */
export const serviceWorkerCacheName = (m: ReleaseManifest): string =>
  `${serviceWorkerCachePrefix(m)}${m.build.hash.slice(0, 12)}-${m.project.snapshot.slice(0, 12)}`;

/** Every path `sw.js` precaches: each of `build.files` and `release.json`, sorted. */
export function serviceWorkerPrecache(m: ReleaseManifest): string[] {
  return [...new Set([...m.build.files.map((f) => f.path), RELEASE_FILE])].sort(byCodeUnit);
}

/**
 * The files answered network first, with the cache as the offline
 * fallback: the ones whose names don't change between builds. Everything
 * else in the precache is named by its content and answered cache first.
 */
export function serviceWorkerShell(m: ReleaseManifest): string[] {
  const precache = new Set(serviceWorkerPrecache(m));
  return [INDEX_HTML_FILE, CREDITS_FILE, SERVICE_WORKER_FILE, WEB_MANIFEST_FILE, RELEASE_FILE]
    .filter((path) => precache.has(path))
    .sort(byCodeUnit);
}

/**
 * `sw.js`, a plain script with its file list inline: `install` precaches
 * the build, `activate` deletes this project's other caches, and `fetch`
 * answers the build's files (a request for the directory is `index.html`),
 * leaving every other request to the network. A single `Range: bytes=…`
 * request for a cached file (a streamed clip played offline) is answered
 * from the cached body: 206 with the slice, or 416 outside it. Its state
 * lives in one closure, so nothing leaks onto the worker's global scope.
 */
export function renderServiceWorker(m: ReleaseManifest): string {
  const json = (value: unknown) => JSON.stringify(value);
  return `"use strict";
(() => {
  const CACHE = ${json(serviceWorkerCacheName(m))};
  const PREFIX = ${json(serviceWorkerCachePrefix(m))};
  const FILES = ${json(serviceWorkerPrecache(m))};
  const SHELL = new Set(${json(serviceWorkerShell(m))});
  const INDEX = ${json(INDEX_HTML_FILE)};

  const urlOf = (path) => new URL(path, self.location.href).href;
  const BY_URL = new Map(FILES.map((path) => [urlOf(path), path]));
  const DIRECTORY = urlOf("./");
  const isOwnCache = (name) =>
    name.startsWith(PREFIX) && /^[0-9a-f]{12}-[0-9a-f]{12}$/.test(name.slice(PREFIX.length));

  const RANGE = /^bytes=(\\d*)-(\\d*)$/i;

  // [start, end] inclusive; null when the header isn't one range we read
  // (the whole body answers), false when it lies outside the body.
  function byteRange(header, size) {
    const match = RANGE.exec(header.trim());
    if (!match || (match[1] === "" && match[2] === "")) return null;
    if (match[1] === "") {
      const start = Math.max(0, size - Number(match[2]));
      return Number(match[2]) === 0 || start >= size ? false : [start, size - 1];
    }
    const start = Number(match[1]);
    if (match[2] !== "" && Number(match[2]) < start) return null;
    if (start >= size) return false;
    return [start, match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1)];
  }

  function partial(cached, header) {
    return cached.blob().then((body) => {
      const span = byteRange(header, body.size);
      const headers = new Headers(cached.headers);
      headers.set("Accept-Ranges", "bytes");
      if (span === null)
        return new Response(body, { status: cached.status, statusText: cached.statusText, headers });
      if (span === false) {
        headers.delete("Content-Length");
        headers.set("Content-Range", "bytes */" + body.size);
        return new Response(null, { status: 416, statusText: "Range Not Satisfiable", headers });
      }
      const [start, end] = span;
      headers.set("Content-Range", "bytes " + start + "-" + end + "/" + body.size);
      headers.set("Content-Length", String(end - start + 1));
      return new Response(body.slice(start, end + 1), {
        status: 206,
        statusText: "Partial Content",
        headers,
      });
    });
  }

  function fileOf(request) {
    const url = new URL(request.url);
    url.search = "";
    url.hash = "";
    if (url.href === DIRECTORY) return INDEX;
    return BY_URL.get(url.href);
  }

  self.addEventListener("install", (event) => {
    event.waitUntil(
      caches
        .open(CACHE)
        .then((cache) => cache.addAll(FILES.map((path) => new Request(urlOf(path), { cache: "reload" })))),
    );
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter((name) => name !== CACHE && isOwnCache(name))
              .map((name) => caches.delete(name)),
          ),
        )
        .then(() => self.clients.claim()),
    );
  });

  self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;
    const path = fileOf(request);
    if (path === undefined) return;
    const key = urlOf(path);
    event.respondWith(
      caches.open(CACHE).then((cache) => {
        if (SHELL.has(path))
          return fetch(request).catch(() =>
            cache.match(key).then((cached) => cached || Response.error()),
          );
        const range = request.headers.get("Range");
        return cache.match(key).then((cached) => {
          if (cached) return range ? partial(cached, range) : cached;
          return fetch(request).then((response) => {
            if (response.status === 200) cache.put(key, response.clone());
            return response;
          });
        });
      }),
    );
  });
})();
`;
}
