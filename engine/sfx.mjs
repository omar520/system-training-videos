// Sound effects, made in code (no outside sound files): mouse clicks, key taps,
// zoom whooshes, callout pops, scroll swishes and soft tones for the cards.
// mixTrack() places them at their times and writes one 48 kHz 16-bit WAV.
import fs from "node:fs";

export const RATE = 48000;

// A small seeded random generator, so every build sounds the same
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

function buf(seconds) {
  return new Float32Array(Math.ceil(seconds * RATE));
}

/** A short mechanical transient: filtered noise plus a tiny resonance. */
function tap({ len, amp, cutoff, tone, toneDecay, seed, body = 0, bodyFreq = 140 }) {
  const out = buf(len);
  const r = rng(seed);
  let lp = 0;
  const a = Math.exp((-2 * Math.PI * cutoff) / RATE);
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const env = Math.exp(-t / (len / 5));
    lp = a * lp + (1 - a) * r();
    const noise = (r() - lp) * 0.5 + lp; // a little brighter than plain low-pass
    const res = Math.sin(2 * Math.PI * tone * t) * Math.exp(-t / toneDecay);
    const thump = body * Math.sin(2 * Math.PI * bodyFreq * t) * Math.exp(-t / 0.012);
    out[i] = amp * (noise * env + 0.6 * res) + thump;
  }
  return out;
}

/** Band-limited noise with a smooth swell: zoom whoosh and scroll swish. */
function whoosh({ len, amp, from, to, seed }) {
  const out = buf(len);
  const r = rng(seed);
  let lp1 = 0;
  let lp2 = 0;
  for (let i = 0; i < out.length; i++) {
    const u = i / out.length;
    const fc = from * Math.pow(to / from, u);
    const a = Math.exp((-2 * Math.PI * fc) / RATE);
    lp1 = a * lp1 + (1 - a) * r();
    lp2 = a * lp2 + (1 - a) * lp1;
    const env = Math.pow(Math.sin(Math.PI * u), 1.6);
    out[i] = amp * 3 * lp2 * env;
  }
  return out;
}

/** A soft rounded "pop" when a callout appears. */
function pop({ amp }) {
  const out = buf(0.12);
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const f = 740 - 260 * Math.min(1, t / 0.05);
    phase += (2 * Math.PI * f) / RATE;
    const env = Math.min(1, t / 0.004) * Math.exp(-t / 0.03);
    out[i] = amp * Math.sin(phase) * env;
  }
  return out;
}

/** A gentle two-note tone for title and chapter cards. */
function chime({ amp, notes = [523.25, 783.99], len = 1.6 }) {
  const out = buf(len);
  notes.forEach((f, k) => {
    const delay = k * 0.09;
    for (let i = 0; i < out.length; i++) {
      const t = i / RATE - delay;
      if (t < 0) continue;
      const env = Math.min(1, t / 0.015) * Math.exp(-t / 0.45);
      out[i] +=
        (amp / notes.length) *
        env *
        (Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(2 * Math.PI * 2 * f * t));
    }
  });
  return out;
}

const cache = new Map();
function sound(kind, ev, n) {
  // Key taps vary a little each time, like a real keyboard
  if (kind === "key") {
    const v = n % 7;
    return tap({
      len: ev.big ? 0.05 : 0.035,
      amp: ev.big ? 0.16 : 0.09 + v * 0.006,
      cutoff: 2400 + v * 260,
      tone: 1800 + v * 140,
      toneDecay: 0.004,
      seed: 101 + v,
      body: ev.big ? 0.05 : 0.02,
      bodyFreq: 180,
    });
  }
  const key = `${kind}:${ev.soft ? 1 : 0}`;
  if (cache.has(key)) return cache.get(key);
  let s;
  switch (kind) {
    case "click": {
      // mouse button down, then the lighter release 70 ms later
      const down = tap({
        len: 0.03,
        amp: 0.22,
        cutoff: 3800,
        tone: 2600,
        toneDecay: 0.003,
        seed: 7,
        body: 0.07,
      });
      const up = tap({ len: 0.025, amp: 0.1, cutoff: 4200, tone: 3000, toneDecay: 0.002, seed: 9 });
      s = buf(0.12);
      s.set(down, 0);
      const off = Math.round(0.07 * RATE);
      for (let i = 0; i < up.length && off + i < s.length; i++) s[off + i] += up[i];
      break;
    }
    case "whooshIn":
      s = whoosh({ len: 0.75, amp: 0.11, from: 300, to: 2400, seed: 21 });
      break;
    case "whooshOut":
      s = whoosh({ len: 0.75, amp: 0.09, from: 2200, to: 260, seed: 23 });
      break;
    case "swish":
      s = whoosh({ len: 0.45, amp: 0.045, from: 700, to: 1500, seed: 31 });
      break;
    case "pop":
      s = pop({ amp: ev.soft ? 0.07 : 0.11 });
      break;
    case "tick":
      s = pop({ amp: 0.05 });
      break;
    case "chime":
      s = ev.soft
        ? chime({ amp: 0.09, notes: [659.25, 523.25], len: 1.3 })
        : chime({ amp: 0.12, notes: [523.25, 659.25, 783.99], len: 1.8 });
      break;
    default:
      s = buf(0.01);
  }
  cache.set(key, s);
  return s;
}

/**
 * Mix the sound events into one track.
 * @param items [{ kind, at (seconds in the output), soft, big }]
 */
export function mixTrack(items, durationSec, outFile) {
  const track = new Float32Array(Math.ceil(durationSec * RATE) + RATE);
  let keyN = 0;
  for (const it of items) {
    if (it.at < 0 || it.at > durationSec) continue;
    const s = sound(it.kind, it, it.kind === "key" ? keyN++ : 0);
    const off = Math.round(it.at * RATE);
    for (let i = 0; i < s.length && off + i < track.length; i++) track[off + i] += s[i];
  }
  // Gentle limiter so overlapping sounds never clip
  const n = Math.ceil(durationSec * RATE);
  const pcm = Buffer.alloc(44 + n * 2);
  for (let i = 0; i < n; i++) {
    const v = Math.tanh(track[i] * 1.2) / 1.2;
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32000), 44 + i * 2);
  }
  pcm.write("RIFF", 0);
  pcm.writeUInt32LE(36 + n * 2, 4);
  pcm.write("WAVE", 8);
  pcm.write("fmt ", 12);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(RATE, 24);
  pcm.writeUInt32LE(RATE * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(n * 2, 40);
  fs.writeFileSync(outFile, pcm);
}
