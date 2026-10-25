import { describe, expect, it } from "vitest";
import {
  Resampler,
  float32ToPcm16Base64,
  floatToPcm16,
  levelFromRms,
  pcm16Base64ToFloat32,
  rateFromMime,
  resample,
  rms,
  smoothLevel,
} from "./pcm";

function sine(freq: number, rate: number, n: number, amp = 0.5): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
}

describe("pcm16 encoding", () => {
  it("clamps and scales floats to int16", () => {
    expect(Array.from(floatToPcm16(Float32Array.from([0, 1, -1, 2, -2, 0.5])))).toEqual([
      0, 32767, -32768, 32767, -32768, 16384,
    ]);
  });

  it("writes little-endian bytes", () => {
    const b64 = float32ToPcm16Base64(Float32Array.from([1, -1]));
    expect(Array.from(Buffer.from(b64, "base64"))).toEqual([0xff, 0x7f, 0x00, 0x80]);
  });

  it("round-trips through base64 within one quantization step", () => {
    const input = sine(440, 24000, 2400);
    const back = pcm16Base64ToFloat32(float32ToPcm16Base64(input));
    expect(back.length).toBe(input.length);
    for (let i = 0; i < input.length; i++) expect(Math.abs(back[i]! - input[i]!)).toBeLessThan(1 / 16000);
  });

  it("decodes what a server would send", () => {
    const bytes = Buffer.alloc(4);
    bytes.writeInt16LE(16384, 0);
    bytes.writeInt16LE(-16384, 2);
    const out = pcm16Base64ToFloat32(bytes.toString("base64"));
    expect(out[0]).toBeCloseTo(0.5, 3);
    expect(out[1]).toBeCloseTo(-0.5, 3);
  });

  it("handles large buffers without overflowing the call stack", () => {
    const input = sine(220, 16000, 200_000);
    expect(pcm16Base64ToFloat32(float32ToPcm16Base64(input)).length).toBe(200_000);
  });
});

describe("resampling", () => {
  it("downsamples 48k to 16k at a third of the length and keeps the tone", () => {
    const input = sine(300, 48000, 4800);
    const out = resample(input, 48000, 16000);
    expect(out.length).toBe(1600);
    const expected = sine(300, 16000, 1600);
    // Box averaging shifts phase by one input sample; compare loosely.
    for (let i = 10; i < 1590; i++) expect(Math.abs(out[i]! - expected[i]!)).toBeLessThan(0.05);
  });

  it("handles non-integer ratios like 44.1k", () => {
    const out = resample(sine(300, 44100, 44100), 44100, 16000);
    expect(Math.abs(out.length - 16000)).toBeLessThanOrEqual(2);
    expect(rms(out)).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it("upsamples 16k to 24k", () => {
    const out = resample(sine(200, 16000, 1600), 16000, 24000);
    expect(Math.abs(out.length - 2400)).toBeLessThanOrEqual(2);
    expect(rms(out)).toBeCloseTo(0.5 / Math.SQRT2, 2);
  });

  it("gives the same samples whether fed in chunks or whole", () => {
    const pairs: [number, number][] = [
      [48000, 16000],
      [44100, 16000],
      [16000, 24000],
    ];
    for (const [from, to] of pairs) {
      const input = sine(250, from, 9000);
      const whole = new Resampler(from, to).process(input);
      const r = new Resampler(from, to);
      const parts: number[] = [];
      for (let i = 0; i < input.length; i += 128) parts.push(...r.process(input.subarray(i, i + 128)));
      expect(parts.length).toBe(whole.length);
      for (let i = 0; i < whole.length; i++) expect(parts[i]).toBeCloseTo(whole[i]!, 5);
    }
  });

  it("passes through when the rates match", () => {
    const input = Float32Array.from([0.1, 0.2, 0.3]);
    const out = resample(input, 16000, 16000);
    expect(Array.from(out)).toEqual(Array.from(input));
    expect(out).not.toBe(input);
  });
});

describe("levels", () => {
  it("computes rms", () => {
    expect(rms(new Float32Array(0))).toBe(0);
    expect(rms(Float32Array.from([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
  });

  it("maps rms to a 0..1 level on a decibel scale", () => {
    expect(levelFromRms(0)).toBe(0);
    expect(levelFromRms(0.001)).toBe(0);
    expect(levelFromRms(1)).toBe(1);
    const quiet = levelFromRms(0.01);
    const loud = levelFromRms(0.1);
    expect(quiet).toBeGreaterThan(0);
    expect(loud).toBeGreaterThan(quiet);
    expect(loud).toBeLessThan(1);
  });

  it("rises faster than it falls", () => {
    const up = smoothLevel(0, 1, 16);
    const down = 1 - smoothLevel(1, 0, 16);
    expect(up).toBeGreaterThan(down);
    expect(smoothLevel(0.4, 0.4, 16)).toBeCloseTo(0.4);
  });

  it("reads the sample rate from a mime type", () => {
    expect(rateFromMime("audio/pcm;rate=24000", 16000)).toBe(24000);
    expect(rateFromMime("audio/pcm", 24000)).toBe(24000);
    expect(rateFromMime(undefined, 24000)).toBe(24000);
  });
});
