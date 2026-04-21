/**
 * Programmatic audio generation for the CouponMaxx promo video.
 * Creates audio buffers using Web Audio API, encodes to WAV data URLs.
 */

function createWavDataUrl(
  sampleRate: number,
  channelData: Float32Array
): string {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = channelData.length * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // WAV header
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  // Audio data
  for (let i = 0; i < channelData.length; i++) {
    const sample = Math.max(-1, Math.min(1, channelData[i]));
    view.setInt16(44 + i * 2, sample * 0x7fff, true);
  }

  // Convert to base64 data URL
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return "data:audio/wav;base64," + btoa(binary);
}

/**
 * Background ambient pad - warm, evolving synth tone
 */
export function generateBackgroundPad(durationSeconds: number): string {
  const sr = 44100;
  const len = Math.floor(sr * durationSeconds);
  const data = new Float32Array(len);

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // Very slow-evolving chord: C major spread voicing
    const f1 = 130.81; // C3
    const f2 = 164.81; // E3
    const f3 = 196.00; // G3
    const f4 = 261.63; // C4

    // Soft sine waves with gentle detuning for warmth
    const detune = 1 + Math.sin(t * 0.1) * 0.002;
    const osc1 = Math.sin(2 * Math.PI * f1 * t * detune) * 0.15;
    const osc2 = Math.sin(2 * Math.PI * f2 * t) * 0.12;
    const osc3 = Math.sin(2 * Math.PI * f3 * t / detune) * 0.10;
    const osc4 = Math.sin(2 * Math.PI * f4 * t) * 0.08;

    // Sub bass
    const sub = Math.sin(2 * Math.PI * 65.41 * t) * 0.08;

    // LFO for subtle movement
    const lfo = 1 + Math.sin(t * 0.3) * 0.15;

    // Envelope: fade in first 3s, sustain, fade out last 3s
    let env = 1;
    if (t < 3) env = t / 3;
    if (t > durationSeconds - 3) env = (durationSeconds - t) / 3;

    // Gentle high-pass filter effect (subtract DC and low rumble)
    const sample = (osc1 + osc2 + osc3 + osc4 + sub) * lfo * env * 0.5;
    data[i] = sample;
  }

  return createWavDataUrl(sr, data);
}

/**
 * Error buzz - short harsh sound for coupon failure
 */
export function generateErrorBuzz(): string {
  const sr = 44100;
  const duration = 0.35;
  const len = Math.floor(sr * duration);
  const data = new Float32Array(len);

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // Harsh square-ish wave at low frequency
    const buzz = Math.sign(Math.sin(2 * Math.PI * 80 * t)) * 0.15;
    const noise = (Math.random() - 0.5) * 0.08;
    // Fast decay envelope
    const env = Math.exp(-t * 8);
    data[i] = (buzz + noise) * env;
  }

  return createWavDataUrl(sr, data);
}

/**
 * Success chime - bright ascending tone
 */
export function generateSuccessChime(): string {
  const sr = 44100;
  const duration = 0.8;
  const len = Math.floor(sr * duration);
  const data = new Float32Array(len);

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // Two-note chime: G5 -> C6
    const f = t < 0.25 ? 783.99 : 1046.50;
    const tone = Math.sin(2 * Math.PI * f * t) * 0.2;
    const harmonic = Math.sin(2 * Math.PI * f * 2 * t) * 0.06;
    // Decay with slight sustain on second note
    const env = t < 0.25 ? Math.exp(-t * 4) : Math.exp(-(t - 0.25) * 3) * 0.8;
    data[i] = (tone + harmonic) * env;
  }

  return createWavDataUrl(sr, data);
}

/**
 * Transition whoosh - filtered noise sweep
 */
export function generateWhoosh(): string {
  const sr = 44100;
  const duration = 0.5;
  const len = Math.floor(sr * duration);
  const data = new Float32Array(len);

  // Simple band-pass sweep using a resonant filter approximation
  let prev = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const noise = (Math.random() - 0.5) * 2;
    // Sweep center frequency from 200Hz to 4000Hz
    const sweepFreq = 200 + (t / duration) * 3800;
    const alpha = Math.min(0.99, sweepFreq / sr);
    prev = prev * (1 - alpha) + noise * alpha;
    // Bell-shaped envelope
    const env = Math.sin(Math.PI * t / duration) * 0.25;
    data[i] = prev * env;
  }

  return createWavDataUrl(sr, data);
}

/**
 * Impact hit - deep thump for dramatic moments
 */
export function generateImpact(): string {
  const sr = 44100;
  const duration = 0.6;
  const len = Math.floor(sr * duration);
  const data = new Float32Array(len);

  for (let i = 0; i < len; i++) {
    const t = i / sr;
    // Pitch-dropping sine (starts high, drops to sub)
    const freq = 300 * Math.exp(-t * 8) + 40;
    const tone = Math.sin(2 * Math.PI * freq * t) * 0.3;
    const click = t < 0.01 ? (Math.random() - 0.5) * 0.4 : 0;
    const env = Math.exp(-t * 5);
    data[i] = (tone + click) * env;
  }

  return createWavDataUrl(sr, data);
}
