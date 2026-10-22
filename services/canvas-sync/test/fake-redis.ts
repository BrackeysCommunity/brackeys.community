import net from "node:net";

/**
 * A small in-memory Redis speaking RESP2, enough for what canvas-sync sends:
 * pub/sub (SUBSCRIBE, UNSUBSCRIBE, PUBLISH, PUBSUB NUMSUB), the ledger's
 * strings and sets with expiry, MULTI/EXEC, and ioredis's handshake. It can
 * go down and come back on the same port, which a real Redis in a test
 * can't do without a process manager. It is not a stand-in for checking
 * Dragonfly itself.
 */

type Value = { kind: "string"; value: Buffer } | { kind: "set"; value: Set<string> };
type Reply =
  | { t: "simple"; v: string }
  | { t: "error"; v: string }
  | { t: "int"; v: number }
  | { t: "bulk"; v: Buffer | null }
  | { t: "array"; v: Reply[] | null };

const ok: Reply = { t: "simple", v: "OK" };
const int = (v: number): Reply => ({ t: "int", v });
const bulk = (v: Buffer | string | null): Reply => ({
  t: "bulk",
  v: v === null ? null : Buffer.isBuffer(v) ? v : Buffer.from(v),
});
const array = (v: Reply[] | null): Reply => ({ t: "array", v });

function encode(reply: Reply): Buffer {
  switch (reply.t) {
    case "simple":
      return Buffer.from(`+${reply.v}\r\n`);
    case "error":
      return Buffer.from(`-${reply.v}\r\n`);
    case "int":
      return Buffer.from(`:${reply.v}\r\n`);
    case "bulk":
      return reply.v === null
        ? Buffer.from("$-1\r\n")
        : Buffer.concat([Buffer.from(`$${reply.v.length}\r\n`), reply.v, Buffer.from("\r\n")]);
    case "array":
      return reply.v === null
        ? Buffer.from("*-1\r\n")
        : Buffer.concat([Buffer.from(`*${reply.v.length}\r\n`), ...reply.v.map(encode)]);
  }
}

/** Parses complete RESP arrays of bulk strings off the front of `buffer`. */
function parseCommands(buffer: Buffer): { commands: Buffer[][]; rest: Buffer } {
  const commands: Buffer[][] = [];
  let pos = 0;
  outer: while (pos < buffer.length) {
    if (buffer[pos] !== 0x2a /* * */) {
      // Inline command (redis-cli style); not used by ioredis.
      const end = buffer.indexOf("\r\n", pos);
      if (end < 0) break;
      commands.push(
        buffer
          .subarray(pos, end)
          .toString()
          .split(" ")
          .filter(Boolean)
          .map((s) => Buffer.from(s)),
      );
      pos = end + 2;
      continue;
    }
    const headerEnd = buffer.indexOf("\r\n", pos);
    if (headerEnd < 0) break;
    const count = Number(buffer.subarray(pos + 1, headerEnd).toString());
    let cursor = headerEnd + 2;
    const args: Buffer[] = [];
    for (let i = 0; i < count; i++) {
      const lenEnd = buffer.indexOf("\r\n", cursor);
      if (lenEnd < 0) break outer;
      const len = Number(buffer.subarray(cursor + 1, lenEnd).toString());
      const start = lenEnd + 2;
      if (start + len + 2 > buffer.length) break outer;
      args.push(Buffer.from(buffer.subarray(start, start + len)));
      cursor = start + len + 2;
    }
    commands.push(args);
    pos = cursor;
  }
  return { commands, rest: Buffer.from(buffer.subarray(pos)) };
}

interface Client {
  socket: net.Socket;
  channels: Set<string>;
  multi: Buffer[][] | null;
}

export class FakeRedis {
  private server: net.Server | null = null;
  private readonly clients = new Set<Client>();
  private readonly data = new Map<string, { value: Value; expiresAt: number | null }>();
  /** Every command name seen, for assertions about what was (not) sent. */
  readonly log: string[] = [];
  /** While true, the server accepts sockets but never answers (a hung Redis). */
  hung = false;
  port = 0;

  get url(): string {
    return `redis://127.0.0.1:${this.port}`;
  }

  get connectedClients(): number {
    return this.clients.size;
  }

  subscribers(channel: string): number {
    let n = 0;
    for (const client of this.clients) if (client.channels.has(channel)) n++;
    return n;
  }

  async start(port = this.port): Promise<this> {
    const server = net.createServer((socket) => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    });
    this.server = server;
    this.port = (server.address() as net.AddressInfo).port;
    return this;
  }

  /** Drops every connection and stops listening; `start()` brings it back on the same port. */
  async stop(): Promise<void> {
    for (const client of this.clients) client.socket.destroy();
    this.clients.clear();
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** Forgets every key, as a restarted Redis without persistence would. */
  flush(): void {
    this.data.clear();
  }

  private accept(socket: net.Socket): void {
    const client: Client = { socket, channels: new Set(), multi: null };
    this.clients.add(client);
    let pending: Buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      if (this.hung) return;
      pending = Buffer.concat([pending, chunk]);
      const { commands, rest } = parseCommands(pending);
      pending = rest;
      for (const args of commands) {
        const replies = this.handle(client, args);
        for (const reply of replies) socket.write(encode(reply));
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => this.clients.delete(client));
  }

  private get(key: string): Value | undefined {
    const entry = this.data.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.data.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /** Seconds left on a key, as TTL reports it. */
  ttl(key: string): number {
    const entry = this.data.get(key);
    if (!entry || !this.get(key)) return -2;
    return entry.expiresAt === null ? -1 : Math.ceil((entry.expiresAt - Date.now()) / 1000);
  }

  keys(): string[] {
    return [...this.data.keys()].filter((key) => this.get(key) !== undefined);
  }

  private handle(client: Client, args: Buffer[]): Reply[] {
    if (args.length === 0) return [];
    const name = args[0]!.toString().toUpperCase();
    const str = (i: number) => args[i]!.toString();
    this.log.push(name);

    if (client.multi && !["EXEC", "DISCARD", "MULTI"].includes(name)) {
      client.multi.push(args);
      return [{ t: "simple", v: "QUEUED" }];
    }

    switch (name) {
      case "PING":
        return client.channels.size > 0
          ? [array([bulk("pong"), bulk(args[1] ?? "")])]
          : [args[1] ? bulk(args[1]) : { t: "simple", v: "PONG" }];
      case "INFO":
        return [bulk("# Server\r\nredis_version:7.2.0\r\nloading:0\r\n")];
      case "CLIENT":
      case "SELECT":
      case "AUTH":
        return [ok];
      case "QUIT":
        setImmediate(() => client.socket.end());
        return [ok];
      case "MULTI":
        client.multi = [];
        return [ok];
      case "DISCARD":
        client.multi = null;
        return [ok];
      case "EXEC": {
        const queued = client.multi ?? [];
        client.multi = null;
        return [array(queued.flatMap((cmd) => this.handle(client, cmd)))];
      }
      case "SUBSCRIBE":
        return args.slice(1).map((channel) => {
          client.channels.add(channel.toString());
          return array([bulk("subscribe"), bulk(channel), int(client.channels.size)]);
        });
      case "UNSUBSCRIBE": {
        const channels = args.length > 1 ? args.slice(1).map(String) : [...client.channels];
        return channels.map((channel) => {
          client.channels.delete(channel);
          return array([bulk("unsubscribe"), bulk(channel), int(client.channels.size)]);
        });
      }
      case "PUBLISH": {
        const channel = str(1);
        let receivers = 0;
        const message = encode(array([bulk("message"), bulk(channel), bulk(args[2]!)]));
        for (const other of this.clients) {
          if (!other.channels.has(channel)) continue;
          other.socket.write(message);
          receivers++;
        }
        return [int(receivers)];
      }
      case "PUBSUB": {
        if (str(1).toUpperCase() !== "NUMSUB") return [{ t: "error", v: "ERR unsupported" }];
        return [
          array(
            args
              .slice(2)
              .flatMap((channel) => [bulk(channel), int(this.subscribers(String(channel)))]),
          ),
        ];
      }
      case "SET": {
        const key = str(1);
        let expiresAt: number | null = null;
        let nx = false;
        for (let i = 3; i < args.length; i++) {
          const option = str(i).toUpperCase();
          if (option === "EX") expiresAt = Date.now() + Number(str(++i)) * 1000;
          else if (option === "PX") expiresAt = Date.now() + Number(str(++i));
          else if (option === "NX") nx = true;
        }
        if (nx && this.get(key) !== undefined) return [bulk(null)];
        this.data.set(key, { value: { kind: "string", value: args[2]! }, expiresAt });
        return [ok];
      }
      case "GET": {
        const value = this.get(str(1));
        return [bulk(value?.kind === "string" ? value.value : null)];
      }
      case "MGET":
        return [
          array(
            args.slice(1).map((key) => {
              const value = this.get(String(key));
              return bulk(value?.kind === "string" ? value.value : null);
            }),
          ),
        ];
      case "DEL": {
        let removed = 0;
        for (const key of args.slice(1))
          if (this.get(String(key)) && this.data.delete(String(key))) removed++;
        return [int(removed)];
      }
      case "SADD": {
        const key = str(1);
        let value = this.get(key);
        if (!value) {
          value = { kind: "set", value: new Set() };
          this.data.set(key, { value, expiresAt: null });
        }
        if (value.kind !== "set") return [{ t: "error", v: "WRONGTYPE" }];
        let added = 0;
        for (const member of args.slice(2)) {
          if (!value.value.has(String(member))) added++;
          value.value.add(String(member));
        }
        return [int(added)];
      }
      case "SREM": {
        const value = this.get(str(1));
        if (value?.kind !== "set") return [int(0)];
        let removed = 0;
        for (const member of args.slice(2)) if (value.value.delete(String(member))) removed++;
        return [int(removed)];
      }
      case "SMEMBERS": {
        const value = this.get(str(1));
        return [array(value?.kind === "set" ? [...value.value].map((m) => bulk(m)) : [])];
      }
      case "EXPIRE": {
        const entry = this.data.get(str(1));
        if (!entry || !this.get(str(1))) return [int(0)];
        entry.expiresAt = Date.now() + Number(str(2)) * 1000;
        return [int(1)];
      }
      case "TTL":
        return [int(this.ttl(str(1)))];
      default:
        return [{ t: "error", v: `ERR unknown command '${name}'` }];
    }
  }
}
