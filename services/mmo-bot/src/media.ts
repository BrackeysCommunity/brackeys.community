/** Pictures by media key: a key names its picture's input, so a hit is always current. */
export class MediaCache {
  private readonly bytes = new Map<string, Uint8Array>();

  constructor(
    private readonly fetch: (key: string) => Promise<Uint8Array>,
    private readonly kept = 256,
  ) {}

  async get(key: string): Promise<Uint8Array> {
    const hit = this.bytes.get(key);
    if (hit) return hit;
    const b = await this.fetch(key);
    this.bytes.set(key, b);
    if (this.bytes.size > this.kept) this.bytes.delete(this.bytes.keys().next().value!);
    return b;
  }
}
