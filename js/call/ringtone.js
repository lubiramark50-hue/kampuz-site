/* StreamCampus — ringtones synthesised with WebAudio, so there are no binary assets
 * to ship and nothing to preload. Falls back silently when audio is unavailable. */

let ctx = null;
let timer = null;
let gainNode = null;

const ensureCtx = () => {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  gainNode = ctx.createGain();
  gainNode.gain.value = 0.0001;
  gainNode.connect(ctx.destination);
  return ctx;
};

/** A two-tone chirp; `pattern` is [frequency, startOffset, duration] triples. */
function chirp(pattern, baseGain = 0.16) {
  const c = ensureCtx();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});

  const now = c.currentTime;
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(baseGain, now);

  for (const [freq, offset, duration] of pattern) {
    const osc = c.createOscillator();
    const env = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + offset);
    env.gain.setValueAtTime(0.0001, now + offset);
    env.gain.exponentialRampToValueAtTime(1, now + offset + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);
    osc.connect(env).connect(gainNode);
    osc.start(now + offset);
    osc.stop(now + offset + duration + 0.05);
  }
}

export function startIncomingRing() {
  stopRing();
  const pattern = [
    [660, 0, 0.22], [880, 0.26, 0.22],
    [660, 0.62, 0.22], [880, 0.88, 0.22],
  ];
  const play = () => chirp(pattern, 0.18);
  play();
  timer = setInterval(play, 2400);
}

export function startOutgoingRing() {
  stopRing();
  const pattern = [[440, 0, 0.5], [480, 0.6, 0.5]];
  const play = () => chirp(pattern, 0.09);
  play();
  timer = setInterval(play, 3200);
}

export function playConnected() {
  stopRing();
  chirp([[784, 0, 0.12], [1046, 0.13, 0.18]], 0.13);
}

export function playEnded() {
  stopRing();
  chirp([[520, 0, 0.16], [400, 0.17, 0.24]], 0.11);
}

export function playMessage() {
  chirp([[988, 0, 0.09], [1319, 0.1, 0.13]], 0.1);
}

export function stopRing() {
  if (timer) { clearInterval(timer); timer = null; }
  if (gainNode && ctx) {
    try {
      gainNode.gain.cancelScheduledValues(ctx.currentTime);
      gainNode.gain.setValueAtTime(0.0001, ctx.currentTime);
    } catch {}
  }
}

/** Called from a user gesture so iOS/Chrome allow later automatic playback. */
export function unlockAudio() {
  const c = ensureCtx();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}
