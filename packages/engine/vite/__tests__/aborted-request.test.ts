// @vitest-environment node
import { EventEmitter } from "node:events";
import { readdir } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { connect as netConnect, type AddressInfo } from "node:net";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { ReadableStream } from "node:stream/web";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  guardAbortedRequestBodies,
  holdAbortedErrors,
  isAbortedRequestError,
  unguardAbortedRequestBodies,
} from "../aborted-requests";
import {
  holdStreamErrors,
  listenSceneCollab,
  sceneCollabServer,
  type ListeningSceneCollab,
} from "../collab-server";
import { engineProjectCopy, until, type ProjectCopy } from "./dev-server-fixture";

type Middleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => void;

let copy: ProjectCopy;
const uncaught: unknown[] = [];
const onUncaught = (e: unknown) => uncaught.push(e);

beforeEach(async () => {
  uncaught.length = 0;
  process.on("uncaughtException", onUncaught);
  copy = await engineProjectCopy(["engine-yard.json"]);
});

afterEach(async () => {
  process.off("uncaughtException", onUncaught);
  await copy?.remove();
});

afterAll(() => unguardAbortedRequestBodies());

/** Declares `declared` body bytes, sends `sent`, then drops the connection; resolves once it's closed. */
function abortMidBody(port: number, path: string, declared = 100_000, sent = 16): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(port, "127.0.0.1", () => {
      socket.write(
        `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Length: ${declared}\r\n\r\n`,
      );
      socket.write(Buffer.alloc(sent, 7));
      setTimeout(() => socket.destroy(), 30);
    });
    socket.on("error", reject);
    socket.on("close", () => resolve());
  });
}

/** Sends a GET, then drops the connection as soon as the answer starts arriving. */
function abortMidResponse(port: number, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(port, "127.0.0.1", () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`);
    });
    socket.once("data", () => socket.destroy());
    socket.on("error", reject);
    socket.on("close", () => resolve());
  });
}

/** Lets the server see the hang-up and run every tick its streams schedule. */
const settle = () => new Promise((r) => setTimeout(r, 150));

const blobs = () => readdir(join(copy.cacheDir, "blobs")).catch(() => [] as string[]);

describe("an aborted request on the collab server's own port", () => {
  let server: ListeningSceneCollab;
  afterEach(async () => {
    await server?.close();
  });

  it("ends a blob upload cut off mid-body cleanly and keeps serving", async () => {
    server = await listenSceneCollab({ projects: [copy.project], warn: () => undefined });
    await abortMidBody(server.port, "/__project/engine/blob");
    await settle();
    expect(uncaught).toEqual([]);
    expect(await blobs()).toEqual([]);
    const next = await fetch(`${server.httpUrl}/__project`);
    expect(next.status).toBe(200);
    expect(await next.json()).toMatchObject({ ok: true });
  });
});

describe("an aborted request on the dev server", () => {
  let http: Server;
  const errors: unknown[] = [];

  /** A Vite-shaped host: a middleware stack on an http server, the plugin's hooks on it. */
  async function devServer(before: Middleware[] = [], after: Middleware[] = []) {
    errors.length = 0;
    const stack: Middleware[] = [...before];
    http = createServer((req, res) => {
      let i = 0;
      const next = (err?: unknown) => {
        if (err !== undefined) {
          errors.push(err);
          if (!res.destroyed) res.writeHead(500).end();
          return;
        }
        const fn = stack[i++];
        if (fn) fn(req, res, next);
        else res.writeHead(404).end();
      };
      next();
    });
    sceneCollabServer({ projects: [copy.project], warn: () => undefined }).configureServer({
      middlewares: { use: (fn) => stack.push(fn) },
      httpServer: http,
    });
    stack.push(...after);
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", () => resolve()));
    return (http.address() as AddressInfo).port;
  }

  afterEach(async () => {
    http.closeAllConnections();
    await new Promise((r) => http.close(r));
  });

  it("ends a blob upload cut off mid-body with no write and no error page", async () => {
    const port = await devServer();
    await abortMidBody(port, "/__project/engine/blob");
    await settle();
    expect(uncaught).toEqual([]);
    expect(errors).toEqual([]);
    expect(await blobs()).toEqual([]);
    expect((await fetch(`http://127.0.0.1:${port}/__project`)).status).toBe(200);
  });

  it("survives a middleware that drops its error listener while the abort is in flight", async () => {
    let reached = false;
    // A body reader that stops listening once the request is aborted, after Node has checked
    // for listeners and before it emits: the `error` would otherwise have no listener.
    const careless: Middleware = (req, _res, next) => {
      if (req.url !== "/upload") return next();
      reached = true;
      const listener = () => undefined;
      req.on("error", listener);
      req.on("data", () => undefined);
      req.on("aborted", () =>
        process.nextTick(() => process.nextTick(() => req.off("error", listener))),
      );
    };
    const port = await devServer([careless]);
    await abortMidBody(port, "/upload");
    await settle();
    expect(reached).toBe(true);
    expect(uncaught).toEqual([]);
    await until(
      async () => (await fetch(`http://127.0.0.1:${port}/__project`)).ok,
      "a next answer",
    );
  });

  /**
   * The site framework's dev handler, after the plugin's: it re-streams a request body to its
   * SSR worker through a web stream with no error listener on the Node side, and streams pages
   * back from web streams.
   */
  const framework: Middleware = (req, res, next) => {
    if (req.url === "/_server") {
      const upstream = new Writable({ write: (_chunk, _enc, done) => done() });
      Readable.fromWeb(Readable.toWeb(req)).pipe(upstream);
      upstream.on("finish", () => res.end("ok"));
      return;
    }
    if (req.url === "/page") {
      const page = new ReadableStream<Uint8Array>({
        pull: (c) =>
          new Promise<void>((resolve) =>
            setTimeout(() => {
              c.enqueue(new Uint8Array(1024));
              resolve();
            }, 5),
          ),
      });
      res.writeHead(200, { "content-type": "text/html" });
      Readable.fromWeb(page).pipe(res);
      return;
    }
    next();
  };

  it("survives a body the framework re-streams being cut off mid-body", async () => {
    const port = await devServer([], [framework]);
    await abortMidBody(port, "/_server");
    await settle();
    expect(uncaught).toEqual([]);
    expect(errors).toEqual([]);
    const next = await fetch(`http://127.0.0.1:${port}/_server`, { method: "POST", body: "hi" });
    expect(await next.text()).toBe("ok");
    expect((await fetch(`http://127.0.0.1:${port}/__project`)).status).toBe(200);
  });

  it("survives a client leaving mid-response, on the plugin's routes and the framework's", async () => {
    const port = await devServer([], [framework]);
    await abortMidResponse(port, "/page");
    await abortMidResponse(port, "/__project");
    await settle();
    expect(uncaught).toEqual([]);
    expect(errors).toEqual([]);
    const next = await fetch(`http://127.0.0.1:${port}/_server`, { method: "POST", body: "hi" });
    expect(await next.text()).toBe("ok");
  });
});

describe("the aborted-request guard", () => {
  const aborted = () => Object.assign(new Error("aborted"), { code: "ECONNRESET" });

  it("knows a hang-up from any other error", () => {
    expect(isAbortedRequestError(aborted())).toBe(true);
    expect(isAbortedRequestError(new Error("aborted"))).toBe(false);
    expect(isAbortedRequestError(Object.assign(new Error("read"), { code: "ECONNRESET" }))).toBe(
      false,
    );
    expect(isAbortedRequestError("aborted")).toBe(false);
  });

  it("drops a hang-up nothing listens for and rethrows any other error", () => {
    const stream = new EventEmitter();
    const reported: Error[] = [];
    holdAbortedErrors(stream, (e) => reported.push(e));
    expect(() => stream.emit("error", aborted())).not.toThrow();
    expect(reported).toHaveLength(1);
    expect(() => stream.emit("error", new Error("boom"))).toThrow("boom");
  });

  it("leaves errors to a stream's own listener", () => {
    const stream = new EventEmitter();
    const reported: Error[] = [];
    const own: Error[] = [];
    holdAbortedErrors(stream, (e) => reported.push(e));
    stream.on("error", (e: Error) => own.push(e));
    stream.emit("error", aborted());
    stream.emit("error", new Error("boom"));
    expect(reported).toEqual([]);
    expect(own.map((e) => e.message)).toEqual(["aborted", "boom"]);
  });

  it("holds every Readable.fromWeb stream, warns once and comes off again", () => {
    unguardAbortedRequestBodies();
    const fromWeb = () => Object.getOwnPropertyDescriptor(Readable, "fromWeb")?.value as unknown;
    const original = fromWeb();
    const warned: string[] = [];
    guardAbortedRequestBodies(() => warned.push("first"));
    guardAbortedRequestBodies((m) => warned.push(m));
    const stream = () => Readable.fromWeb(new ReadableStream<Uint8Array>());
    expect(stream().listenerCount("error")).toBe(1);
    stream().emit("error", aborted());
    stream().emit("error", aborted());
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain("aborted");
    unguardAbortedRequestBodies();
    expect(fromWeb()).toBe(original);
    expect(stream().listenerCount("error")).toBe(0);
  });
});

describe("holdStreamErrors", () => {
  it("keeps one listener per stream however often it's called, so an error is never unhandled", () => {
    const stream = new EventEmitter();
    holdStreamErrors(stream, null, undefined);
    holdStreamErrors(stream);
    expect(stream.listenerCount("error")).toBe(1);
    expect(() => stream.emit("error", new Error("aborted"))).not.toThrow();
  });
});
