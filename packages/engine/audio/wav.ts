/** A PCM WAV file's format and its samples. */
export type PcmWav = {
  channels: number;
  sampleRate: number;
  bits: 8 | 16 | 24;
  /** Interleaved by channel, each a signed integer of `bits`; 8-bit ones are written offset to unsigned. */
  samples: ArrayLike<number>;
  /** Chunks written between `fmt ` and `data`, such as an odd-sized `LIST`. */
  extra?: readonly (readonly [tag: string, body: ArrayLike<number>])[];
};

/** The RIFF/WAVE bytes of `wav`: `fmt `, any `extra` chunks, then `data`, each padded to an even size. */
export function pcmWav(wav: PcmWav): Uint8Array {
  const width = wav.bits / 8;
  const blockAlign = width * wav.channels;
  const fmt = new Uint8Array(16);
  const fmtView = new DataView(fmt.buffer);
  fmtView.setUint16(0, 1, true);
  fmtView.setUint16(2, wav.channels, true);
  fmtView.setUint32(4, wav.sampleRate, true);
  fmtView.setUint32(8, wav.sampleRate * blockAlign, true);
  fmtView.setUint16(12, blockAlign, true);
  fmtView.setUint16(14, wav.bits, true);

  const data = new Uint8Array(wav.samples.length * width);
  const dataView = new DataView(data.buffer);
  for (let i = 0; i < wav.samples.length; i++) {
    const level = wav.samples[i] ?? 0;
    if (wav.bits === 8) data[i] = (level + 128) & 0xff;
    else if (wav.bits === 16) dataView.setInt16(i * 2, level, true);
    else {
      const unsigned = level & 0xffffff;
      data[i * 3] = unsigned & 0xff;
      data[i * 3 + 1] = (unsigned >>> 8) & 0xff;
      data[i * 3 + 2] = unsigned >>> 16;
    }
  }

  const chunks: (readonly [string, ArrayLike<number>])[] = [
    ["fmt ", fmt],
    ...(wav.extra ?? []),
    ["data", data],
  ];
  const size = chunks.reduce((n, [, body]) => n + 8 + body.length + (body.length % 2), 12);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  const tag = (at: number, text: string) => {
    for (let k = 0; k < 4; k++) out[at + k] = text.charCodeAt(k);
  };
  tag(0, "RIFF");
  view.setUint32(4, size - 8, true);
  tag(8, "WAVE");
  let at = 12;
  for (const [name, body] of chunks) {
    tag(at, name);
    view.setUint32(at + 4, body.length, true);
    out.set(body, at + 8);
    at += 8 + body.length + (body.length % 2);
  }
  return out;
}

/**
 * An integer triangle wave of `period` samples at sample `phase`, from
 * `-full` to `full`: the generated test clips' signal, exact on every run.
 */
export function triangleLevel(phase: number, period: number, full: number): number {
  const at = phase % period;
  const rise = at < period / 2 ? at : period - at;
  return Math.floor((rise * 4 * full) / period) - full;
}
