export const deserializeEFDateBlob = (blob: Buffer): Date => {
  if (!blob || blob.length < 8) {
    throw new Error('We need at least 8 bytes for deserialization');
  }

  const rawTicks = blob.readBigInt64BE(0);
  const ticks = rawTicks & 0x3FFFFFFFFFFFFFFFn;

  // dotnet ticks are from year 1, conversion needed for JavaScript Date
  const TICKS_PER_MILLISECOND = 10000n;
  const TICKS_AT_UNIX_EPOCH = 621355968000000000n;
  const jsMillis = Number((ticks - TICKS_AT_UNIX_EPOCH) / TICKS_PER_MILLISECOND);

  return new Date(jsMillis);
};

export const handleBigInt = {
  // double checks bigint typesafety
  handle: (value: number | bigint | string): bigint => {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number') return BigInt(value);
    if (typeof value === 'string') return BigInt(value);
    throw new Error(`Cannot convert ${typeof value} to bigint`);
  },

  fromSqlite: (value: number | bigint | string): bigint => handleBigInt.handle(value),
  toMariaDB: (value: number | bigint | string): bigint => handleBigInt.handle(value)
};
