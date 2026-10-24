// Push-to-talk microphone capture: 16 kHz mono PCM straight from the mic,
// with a simple energy gate that stops on 1.4 s of silence after speech.
const RATE = 16000;
const VOICE_RMS = 0.015;
const SILENCE_MS = 1400;
const MAX_MS = 20000;
const NO_VOICE_MS = 6000;

export function createRecorder({ onLevel, onAutoStop }) {
  let ctx = null, stream = null, source = null, proc = null, sink = null;
  let chunks = [];
  let recording = false;
  let startedAt = 0, lastVoiceAt = 0, heardVoice = false;

  async function start() {
    if (recording) return;
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    ctx = new AudioContext({ sampleRate: RATE });
    source = ctx.createMediaStreamSource(stream);
    proc = ctx.createScriptProcessor(2048, 1, 1);
    sink = ctx.createGain();
    sink.gain.value = 0;
    chunks = [];
    recording = true;
    startedAt = performance.now();
    lastVoiceAt = startedAt;
    heardVoice = false;
    proc.onaudioprocess = (e) => {
      if (!recording) return;
      const d = e.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(d));
      let sum = 0;
      for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
      const rms = Math.sqrt(sum / d.length);
      onLevel?.(rms);
      const now = performance.now();
      if (rms > VOICE_RMS) { heardVoice = true; lastVoiceAt = now; }
      const silentLongEnough = heardVoice && now - lastVoiceAt > SILENCE_MS;
      const gaveUp = !heardVoice && now - startedAt > NO_VOICE_MS;
      if (silentLongEnough || gaveUp || now - startedAt > MAX_MS) onAutoStop?.();
    };
    source.connect(proc);
    proc.connect(sink);
    sink.connect(ctx.destination);
  }

  function stop() {
    if (!recording) return null;
    recording = false;
    proc?.disconnect(); source?.disconnect(); sink?.disconnect();
    stream?.getTracks().forEach((t) => t.stop());
    ctx?.close().catch(() => {});
    const sampleRate = ctx?.sampleRate ?? RATE;
    ctx = stream = source = proc = sink = null;
    if (!heardVoice) return null;
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const pcm = new Float32Array(total);
    let off = 0;
    for (const c of chunks) { pcm.set(c, off); off += c.length; }
    return encodeWav(pcm, sampleRate);
  }

  return { start, stop, get recording() { return recording; } };
}

function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}
