function makeTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

const TABLE = makeTable();

/** The CRC-32 (IEEE 802.3) of `bytes`, as zip and PNG use it; pass `crc` to continue a running one. */
export function crc32(bytes: Uint8Array, crc = 0): number {
  let c = ~crc >>> 0;
  for (const b of bytes) c = (TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return ~c >>> 0;
}
