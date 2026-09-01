/**
 * fp16 codec for stored cover embeddings (`itch.entry_scans.cover_embedding`).
 *
 * The scan persists each cover's L2-normalized SigLIP2 image embedding so
 * prompt, anchor, category-shape, and threshold changes can re-score the
 * whole corpus from the DB instead of re-fetching every cover from itch.
 * The ONNX graph scores as `logit = scale * (img · text) + bias`, with the
 * scale and bias recoverable at rescore time from a single forward pass
 * (fit logits against cosines over any one image — the fit is exact to
 * ~3e-3, the model's own fp16 noise); text embeddings for a new prompt list
 * come from that same pass. Only an image-encoder swap invalidates the
 * stored vectors — that's what `embedding_model` records.
 *
 * fp16 on purpose: the model itself runs at fp16 (see nsfw.ts), so wider
 * storage is false precision — measured logit drift from fp16 round-trip is
 * ~1e-3. Hand-rolled because the service's TS lib target predates
 * Float16Array; round-to-nearest-even, matching IEEE 754 half precision.
 */

/** Little-endian fp16 bytes for a vector; 2 bytes per component. */
export function encodeEmbedding(vec: ArrayLike<number>): Buffer {
  const out = Buffer.allocUnsafe(vec.length * 2);
  for (let i = 0; i < vec.length; i++) {
    out.writeUInt16LE(float32ToFloat16(vec[i] ?? 0), i * 2);
  }
  return out;
}

export function decodeEmbedding(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(bytes.byteLength >>> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = float16ToFloat32(view.getUint16(i * 2, true));
  }
  return out;
}

function float32ToFloat16(val: number): number {
  f32[0] = val;
  const x = u32[0] ?? 0;
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0); // Inf / NaN
  const newExp = exp - 127 + 15;
  if (newExp >= 0x1f) return sign | 0x7c00; // overflow -> Inf
  if (newExp <= 0) {
    // Subnormal (or underflow to zero), with round-to-nearest-even.
    if (newExp < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - newExp;
    const half = mant >>> shift;
    const rem = mant & ((1 << shift) - 1);
    const tie = 1 << (shift - 1);
    return sign | (half + (rem > tie || (rem === tie && half & 1) ? 1 : 0));
  }
  const half = sign | (newExp << 10) | (mant >>> 13);
  const rem = mant & 0x1fff;
  // Round to nearest even; a mantissa carry correctly overflows into the
  // exponent bits (and to Inf at the very top).
  return half + (rem > 0x1000 || (rem === 0x1000 && half & 1) ? 1 : 0);
}

function float16ToFloat32(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h & 0x7c00) >>> 10;
  const mant = h & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 0x1f) return mant ? NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
