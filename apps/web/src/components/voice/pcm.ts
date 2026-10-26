// Small, dependency-free audio helpers shared by the live voice session.

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function floatToPcm16(input: Float32Array): Int16Array<ArrayBuffer> {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

export function pcm16ToFloat(input: Int16Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = input[i]!;
    out[i] = s / (s < 0 ? 0x8000 : 0x7fff);
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + step)));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// PCM16 on the wire is little-endian; read and write it explicitly so the result
// does not depend on the platform's byte order.
export function float32ToPcm16Base64(input: Float32Array): string {
  const pcm = floatToPcm16(input);
  const bytes = new Uint8Array(pcm.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < pcm.length; i++) view.setInt16(i * 2, pcm[i]!, true);
  return bytesToBase64(bytes);
}

export function pcm16Base64ToFloat32(b64: string): Float32Array<ArrayBuffer> {
  const bytes = base64ToBytes(b64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = Math.floor(bytes.byteLength / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = view.getInt16(i * 2, true);
    out[i] = s / (s < 0 ? 0x8000 : 0x7fff);
  }
  return out;
}

/** Reads the sample rate out of a mime type such as "audio/pcm;rate=24000". */
export function rateFromMime(mime: string | undefined, fallback: number): number {
  const m = mime?.match(/rate=(\d+)/);
  return m ? Number(m[1]) : fallback;
}

/**
 * Streaming resampler. Downsampling averages each output window (a cheap
 * low-pass that keeps speech clean); upsampling interpolates linearly. It keeps
 * its position between chunks so a stream resampled in pieces matches the same
 * stream resampled whole.
 */
export class Resampler {
  readonly fromRate: number;
  readonly toRate: number;
  private pending = new Float32Array(0);
  // Absolute index of pending[0] in the input stream, and outputs produced so far.
  // Positions are computed from these integers so chunking never drifts.
  private base = 0;
  private produced = 0;

  constructor(fromRate: number, toRate: number) {
    this.fromRate = Math.round(fromRate);
    this.toRate = Math.round(toRate);
  }

  private start(k: number): number {
    return Math.floor((k * this.fromRate) / this.toRate);
  }

  process(input: Float32Array): Float32Array<ArrayBuffer> {
    if (this.fromRate === this.toRate) return input.slice();
    const buf = new Float32Array(this.pending.length + input.length);
    buf.set(this.pending, 0);
    buf.set(input, this.pending.length);
    const end = this.base + buf.length;

    const out: number[] = [];
    let k = this.produced;
    if (this.fromRate > this.toRate) {
      while (this.start(k + 1) <= end) {
        const s = this.start(k) - this.base;
        const e = this.start(k + 1) - this.base;
        let sum = 0;
        for (let i = s; i < e; i++) sum += buf[i]!;
        out.push(sum / (e - s));
        k++;
      }
    } else {
      while (this.start(k) + 1 < end) {
        const i = this.start(k) - this.base;
        const f = ((k * this.fromRate) % this.toRate) / this.toRate;
        out.push(buf[i]! * (1 - f) + buf[i + 1]! * f);
        k++;
      }
    }
    const keep = Math.min(this.start(k), end) - this.base;
    this.pending = buf.slice(keep);
    this.base += keep;
    this.produced = k;
    return Float32Array.from(out);
  }

  reset(): void {
    this.pending = new Float32Array(0);
    this.base = 0;
    this.produced = 0;
  }
}

export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array<ArrayBuffer> {
  return new Resampler(fromRate, toRate).process(input);
}

export function rms(input: Float32Array): number {
  if (input.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < input.length; i++) sum += input[i]! * input[i]!;
  return Math.sqrt(sum / input.length);
}

/** Maps an RMS amplitude to 0..1 on a decibel scale: -60 dB is silent, -12 dB is full. */
export function levelFromRms(value: number): number {
  if (value <= 0) return 0;
  const db = 20 * Math.log10(value);
  return clamp01((db + 60) / 48);
}

/** Moves toward a target quickly on the way up and slowly on the way down. */
export function smoothLevel(prev: number, target: number, dtMs: number, attackMs = 40, releaseMs = 180): number {
  const tau = target > prev ? attackMs : releaseMs;
  const a = 1 - Math.exp(-Math.max(0, dtMs) / tau);
  return prev + (target - prev) * a;
}
