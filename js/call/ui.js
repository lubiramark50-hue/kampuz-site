/* StreamCampus — call surfaces: incoming ring, active stage, controls, call history.
 * All state flows through CallEngine; this module only renders and wires buttons. */

import { session, api } from '../api.js';
import { esc, h, icon, toast, avatar, timeAgo } from '../ui.js';
import { connectCall, callHub, callConnectionId } from '../realtime.js';
import { CallEngine, mediaSupported, enumerate } from './engine.js';
import { startIncomingRing, startOutgoingRing, playConnected, playEnded, stopRing, unlockAudio } from './ringtone.js';

/* ────────────────────────── singleton layer ────────────────────────── */

let layer = null;
function layerRoot() {
  if (!layer) {
    layer = document.getElementById('call-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'call-layer';
      layer.className = 'call-layer';
      document.body.appendChild(layer);
    }
  }
  return layer;
}

/** The one live call. Only a single call can be on screen at a time. */
let active = null;   // { dto, engine, startedAt, endedAt, timerId, state }

/* ────────────────────────── public entry points ────────────────────── */

export async function initCalls() {
  const hub = await connectCall();
  if (!hub) {
    console.warn('[call] hub unavailable — calling disabled');
    return;
  }

  hub.off('incomingCall');
  hub.on('incomingCall', (dto) => {
    if (active) {
      // Already busy: tell the caller instead of silently ignoring the ring.
      hub.invoke('DeclineCall', dto.id).catch(() => {});
      return;
    }
    showIncoming(dto);
  });

  hub.off('callTimedOut');
  hub.on('callTimedOut', ({ callId }) => {
    if (active?.dto?.id === callId && active.state === 'outgoing') {
      teardown();
      toast('No answer', 'info');
    }
  });
}

/** Ring one user. Used by the profile and chat headers. */
export async function startCall(targetUserId, kind = 'video', displayName = 'Student') {
  if (active) return toast('You are already in a call', 'info');
  if (!mediaSupported()) return toast('This device cannot make calls', 'err');
  unlockAudio();

  const hub = await connectCall();
  if (!hub) return toast('Calling service unavailable', 'err');

  const dto = {
    id: null, kind, calleeId: targetUserId, calleeName: displayName,
    callerId: session.user.id, callerName: session.user.fullName,
    status: 'ringing', isGroup: false, participants: [],
  };

  renderStage({ ...dto, id: 'pending' }, { state: 'outgoing' });
  startOutgoingRing();

  try {
    const call = await hub.invoke('StartCall', targetUserId, kind);
    if (active) active.dto = call;
    // Retarget the stage if the caller's own record differs (e.g. reused call).
    active && (active.dto = call);
    patchStageHeader(call);
    attachStageHandlers(call);
  } catch (e) {
    stopRing();
    teardown();
    toast(e?.message === 'busy' ? `${displayName} is on another call` : 'Could not place the call', 'err');
  }
}

export function activeCall() { return active; }

/**
 * Diagnostic snapshot of the live call. Used by the end-to-end suite to assert on real
 * WebRTC state rather than on pixels, and handy when debugging a stuck call.
 */
function publishCallState() {
  window.__scCallState = () => {
    if (!active) return { active: false };
    const peerStates = {};
    for (const [connId, peer] of active.engine?.peers ?? []) {
      peerStates[connId] = {
        connectionState: peer.pc.connectionState,
        iceConnectionState: peer.pc.iceConnectionState,
        signalingState: peer.pc.signalingState,
        hasRemoteStream: !!peer.stream,
        remoteVideoWidth: layerRoot().querySelector(`[data-conn="${CSS.escape(connId)}"] .ct-video`)?.videoWidth ?? 0,
      };
    }
    return {
      active: true,
      state: active.state,
      callId: active.dto?.id,
      kind: active.dto?.kind,
      isGroup: !!active.dto?.isGroup,
      muted: !!active.engine?.muted,
      cameraOff: !!active.engine?.cameraOff,
      sharing: !!active.engine?.sharing,
      localTracks: (active.engine?.localStream?.getTracks() ?? []).map(t => ({
        kind: t.kind, enabled: t.enabled, readyState: t.readyState,
      })),
      elapsedMs: active.startedAt ? Date.now() - active.startedAt : 0,
      peerCount: active.engine?.peers.size ?? 0,
      peers: peerStates,
      tiles: layerRoot().querySelectorAll('.call-tile').length,
    };
  };
}

/** Open (or join) a mesh study room, optionally bound to a course. */
export async function startGroupRoom(courseId, title, kind = 'video') {
  if (active) return toast('You are already in a call', 'info');
  if (!mediaSupported()) return toast('This device cannot make calls', 'err');
  unlockAudio();

  const hub = await connectCall();
  if (!hub) return toast('Calling service unavailable', 'err');

  renderStage({ id: 'pending', kind, isGroup: true, title, callerId: session.user.id, participants: [] },
    { state: 'outgoing' });
  startOutgoingRing();

  try {
    const call = await hub.invoke('StartGroupCall', courseId || null, title, kind);
    active.dto = call;
    stopRing();
    patchStageHeader(call);
    attachStageHandlers(call);
    await beginMedia(call, []);
    active.state = 'active';
    playConnected();
    startTimer();
    renderDock();
    toast('Study room is live — coursemates have been invited', 'ok', 3200);
  } catch (e) {
    stopRing();
    teardown();
    toast(e?.message || 'Could not open the study room', 'err');
  }
}

/* ────────────────────────── incoming ring ──────────────────────────── */

function showIncoming(dto) {
  const root = layerRoot();
  root.classList.add('open', 'incoming');
  unlockAudio();

  const isVideo = dto.kind === 'video';
  root.innerHTML = `
    <div class="ring-backdrop"></div>
    <div class="incoming-card" role="dialog" aria-modal="true" aria-label="Incoming call">
      <div class="ic-avatar">${avatar(dto.callerName, 108, dto.callerAvatarUrl).outerHTML}</div>
      <div class="ic-name">${esc(dto.callerName)}</div>
      <div class="ic-sub">${isVideo ? 'Incoming video call' : 'Incoming audio call'}${dto.isGroup ? ' · group' : ''}</div>
      <div class="ic-actions">
        <button class="call-btn reject" data-decline aria-label="Decline">${icon('phoneOff').outerHTML}</button>
        <button class="call-btn accept" data-accept aria-label="Accept">${icon(isVideo ? 'cam' : 'phone').outerHTML}</button>
      </div>
      <button class="ic-message" data-message>Reply with a message</button>
    </div>`;

  startIncomingRing();

  root.querySelector('[data-accept]').addEventListener('click', () => acceptIncoming(dto));
  root.querySelector('[data-decline]').addEventListener('click', async () => {
    stopRing();
    root.classList.remove('open', 'incoming');
    root.innerHTML = '';
    (await connectCall())?.invoke('DeclineCall', dto.id).catch(() => {});
  });
  root.querySelector('[data-message]').addEventListener('click', async () => {
    stopRing();
    root.classList.remove('open', 'incoming');
    root.innerHTML = '';
    (await connectCall())?.invoke('DeclineCall', dto.id).catch(() => {});
    location.hash = `/messages/${encodeURIComponent(dto.callerId)}`;
  });
}

async function acceptIncoming(dto) {
  stopRing();
  const root = layerRoot();
  root.classList.remove('incoming');
  root.innerHTML = '';

  const hub = await connectCall();
  if (!hub) { root.classList.remove('open'); return; }

  renderStage(dto, { state: 'connecting' });

  try {
    const result = await hub.invoke('AcceptCall', dto.id);
    const call = result.call ?? dto;
    active.dto = call;
    patchStageHeader(call);
    attachStageHandlers(call);

    await beginMedia(call, result.existingPeerConnectionIds || []);
    active.state = 'active';
    playConnected();
    startTimer();
    renderDock();
  } catch (e) {
    toast(e?.message || 'Could not join the call', 'err');
    teardown();
  }
}

/* ────────────────────────── active stage ───────────────────────────── */

function renderStage(dto, { state = 'connecting' } = {}) {
  const root = layerRoot();
  root.classList.add('open');
  root.classList.remove('incoming');

  active = {
    dto, state,
    engine: null,
    // Signalling that arrived before the engine finished starting up.
    pendingSignals: [],
    startedAt: null,
    timerId: null,
    peers: new Map(),      // connectionId -> { name, userId, stream, tile }
    speakingTimer: null,
  };

  root.innerHTML = `
    <div class="call-stage">
      <header class="cs-head">
        <div class="cs-peer">
          <div class="cs-name" data-cs-name>${esc(dto.calleeName || dto.title || 'Call')}</div>
          <div class="cs-meta"><span data-cs-status>${state === 'outgoing' ? 'Ringing…' : 'Connecting…'}</span>
            <span class="cs-quality" data-cs-quality hidden></span></div>
        </div>
        <div class="cs-head-actions">
          <button class="cs-icon" data-pip title="Picture in picture">${icon('pip').outerHTML}</button>
          <button class="cs-icon" data-fullscreen title="Full screen">${icon('expand').outerHTML}</button>
        </div>
      </header>

      <div class="cs-grid" data-cs-grid></div>

      <div class="cs-self" data-cs-self>
        <video autoplay playsinline muted></video>
        <div class="cs-self-off" hidden>${icon('camOff').outerHTML}<span>Camera off</span></div>
        <div class="cs-self-label">You</div>
      </div>

      <div class="cs-dock" data-cs-dock></div>
    </div>`;

  renderDock();
  publishCallState();
  root.querySelector('[data-fullscreen]').addEventListener('click', () => {
    const el = root.querySelector('.call-stage');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  });
  root.querySelector('[data-pip]').addEventListener('click', togglePip);
}

function patchStageHeader(dto) {
  const root = layerRoot();
  const name = dto.isGroup
    ? (dto.title || 'Study room')
    : (dto.callerId === session.user.id ? dto.calleeName : dto.callerName);
  const el = root.querySelector('[data-cs-name]');
  if (el) el.textContent = name || 'Call';
}

/** Route one buffered hub event into the engine. */
function applySignal(engine, kind, args) {
  switch (kind) {
    case 'offer': return engine.handleOffer(args[0], args[1]);
    case 'answer': return engine.handleAnswer(args[0], args[1]);
    case 'iceCandidate': return engine.handleIce(args[0], args[1]);
    case 'renegotiate': return engine.handleRenegotiate(args[0]?.fromConnectionId ?? args[0]);
    default: return undefined;
  }
}

/** Replay anything that landed while the media pipeline was starting. */
function flushPendingSignals() {
  if (!active?.engine) return;
  const queue = active.pendingSignals || [];
  active.pendingSignals = [];
  for (const { kind, args } of queue) {
    try { applySignal(active.engine, kind, args); }
    catch (e) { console.debug('[call] buffered signal failed', kind, e?.message); }
  }
  if (queue.length) console.debug(`[call] replayed ${queue.length} buffered signal(s)`);
}

function attachStageHandlers(dto) {
  const root = layerRoot();
  const hub = callHub();
  if (!hub) return;

  // Remove handlers from a previous call so events never double-fire.
  ['callAccepted', 'callDeclined', 'callCancelled', 'callEnded', 'peerJoined', 'peerLeft', 'peerMediaState']
    .forEach(ev => hub.off(ev));

  // ── signalling plane ───────────────────────────────────────────────
  // Registered here, not inside CallEngine, so a peer that offers before our
  // getUserMedia resolves is buffered instead of lost (a real failure mode: the
  // callee accepts and offers within a few hundred ms, while camera permission can
  // take seconds).
  ['offer', 'answer', 'iceCandidate', 'renegotiate'].forEach(ev => hub.off(ev));

  const deliver = (kind) => (...args) => {
    const engine = active?.engine;
    if (!engine) {
      active?.pendingSignals.push({ kind, args });
      return;
    }
    applySignal(engine, kind, args);
  };

  hub.on('offer', deliver('offer'));
  hub.on('answer', deliver('answer'));
  hub.on('iceCandidate', deliver('iceCandidate'));
  hub.on('renegotiate', deliver('renegotiate'));

  hub.on('callAccepted', async (call) => {
    if (active?.dto?.id !== call.id) return;
    active.dto = call;
    stopRing();
    playConnected();
    if (active.state === 'outgoing') {
      await beginMedia(call, []);
      active.state = 'active';
      startTimer();
      renderDock();
    }
  });

  hub.on('callDeclined', () => {
    if (active?.state !== 'outgoing') return;
    playEnded();
    toast('Call declined', 'info');
    teardown();
  });

  hub.on('callCancelled', () => {
    if (!active) return;
    playEnded();
    toast('Call ended', 'info');
    teardown();
  });

  hub.on('callEnded', () => {
    if (!active) return;
    playEnded();
    toast('Call ended', 'info');
    teardown();
  });

  hub.on('peerJoined', ({ connectionId, name, userId }) => {
    if (!active || connectionId === callConnectionId()) return;
    active.engine?.addPeer(connectionId, { name, userId });
    ensureTile(connectionId, { name, userId });
  });

  hub.on('peerLeft', ({ connectionId }) => {
    if (!active) return;
    active.engine?.removePeer(connectionId);
    active.peers.get(connectionId)?.tile?.remove();
    active.peers.delete(connectionId);
    updateGridLayout();
    renderDock();
    updateStatus();
  });

  hub.on('peerMediaState', ({ userId, isMuted, isCameraOff, isScreenSharing }) => {
    if (!active) return;
    for (const [, p] of active.peers) {
      if (p.userId !== userId) continue;
      p.tile?.classList.toggle('muted', isMuted);
      p.tile?.querySelector('[data-tile-mute]')?.toggleAttribute('hidden', !isMuted);
      p.tile?.querySelector('.ct-video')?.toggleAttribute('hidden', isCameraOff && !isScreenSharing);
      p.tile?.querySelector('.ct-camoff')?.toggleAttribute('hidden', !(isCameraOff && !isScreenSharing));
      p.tile?.querySelector('[data-tile-share]')?.toggleAttribute('hidden', !isScreenSharing);
    }
  });
}

async function beginMedia(call, existingPeerConnectionIds) {
  const hub = callHub();
  const kind = call.kind || 'video';

  const engine = new CallEngine({
    hub, callId: call.id,
    selfId: session.user.id,
    selfConn: callConnectionId(),
  });
  active.engine = engine;

  engine.addEventListener('track', ({ detail }) => {
    const tile = ensureTile(detail.connectionId, { name: detail.name, userId: detail.userId });
    const video = tile.querySelector('.ct-video');
    if (video && video.srcObject !== detail.stream) {
      video.srcObject = detail.stream;
      video.play().catch(() => {});
    }
    tile.querySelector('.ct-wait')?.setAttribute('hidden', '');
  });
  engine.addEventListener('peeradded', ({ detail }) => ensureTile(detail.connectionId, detail));
  engine.addEventListener('peerremoved', ({ detail }) => {
    active?.peers.get(detail.connectionId)?.tile?.remove();
    active?.peers.delete(detail.connectionId);
    updateGridLayout();
  });
  engine.addEventListener('state', () => updateStatus());
  engine.addEventListener('error', ({ detail }) => toast(`${detail.scope}: ${detail.message}`, 'err'));
  engine.addEventListener('screenshare', ({ detail }) =>
    toast(detail.active ? 'Sharing your screen' : 'Stopped sharing', 'info', 1800));

  let localStream = null;
  try {
    localStream = await engine.startLocalMedia({ video: kind === 'video', audio: true });
  } catch (err) {
    // Audio-only fallback keeps the call usable when the camera is missing or denied.
    if (kind === 'video') {
      try {
        localStream = await engine.startLocalMedia({ video: false, audio: true });
        toast('Camera unavailable — joined with audio only', 'info', 3200);
      } catch {
        toast('No microphone or camera access — you have joined muted', 'err', 4200);
      }
    } else {
      toast('Microphone unavailable — you have joined muted', 'err', 3200);
    }
  }

  const selfVideo = layerRoot().querySelector('.cs-self video');
  if (selfVideo && localStream) {
    selfVideo.srcObject = localStream;
    selfVideo.play().catch(() => {});
  }
  layerRoot().querySelector('.cs-self')?.classList.toggle('audio-only', kind !== 'video');

  // Mesh formation: offer to everyone already in the room.
  for (const connId of existingPeerConnectionIds) {
    engine.addPeer(connId);
    ensureTile(connId, {});
  }

  engine.addEventListener('localstream', ({ detail }) => {
    const v = layerRoot().querySelector('.cs-self video');
    if (v) v.srcObject = detail.stream;
  });

  // Anything the far side sent while we were acquiring media is applied now.
  flushPendingSignals();

  startQualityPolling();
  return engine;
}

/* ────────────────────────── tiles ──────────────────────────────────── */

function ensureTile(connectionId, { name = '', userId = '' } = {}) {
  if (!active) return document.createElement('div');
  const known = active.peers.get(connectionId);
  if (known?.tile) {
    if (name) {
      known.name = name;
      known.tile.querySelector('.ct-name').textContent = name;
    }
    if (userId) known.userId = userId;
    return known.tile;
  }

  const isAudio = active.dto.kind === 'audio';
  const tile = h(`<div class="call-tile ${isAudio ? 'audio' : ''}" data-conn="${esc(connectionId)}">
    <video class="ct-video" autoplay playsinline ${isAudio ? 'hidden' : ''}></video>
    <div class="ct-camoff" ${isAudio ? '' : 'hidden'}>
      <div class="ct-avatar">${avatar(name || 'Student', 84).outerHTML}</div>
    </div>
    <div class="ct-wait" ${isAudio ? 'hidden' : ''}><span class="spinner"></span></div>
    <div class="ct-bar">
      <span class="ct-name">${esc(name || 'Connecting…')}</span>
      <span class="ct-mute" data-tile-mute hidden>${icon('micOff').outerHTML}</span>
      <span class="ct-share" data-tile-share hidden>${icon('screen').outerHTML}</span>
    </div>
  </div>`);

  layerRoot().querySelector('[data-cs-grid]')?.appendChild(tile);
  active.peers.set(connectionId, { name, userId, tile, stream: null });
  updateGridLayout();
  renderDock();
  return tile;
}

/** Lets CSS size a single remote tile as a proper video frame. */
function updateGridLayout() {
  const grid = layerRoot().querySelector('[data-cs-grid]');
  if (!grid) return;
  grid.dataset.count = String(layerRoot().querySelectorAll('.call-tile').length);
}

/* ────────────────────────── control dock ───────────────────────────── */

function renderDock() {
  const dock = layerRoot().querySelector('[data-cs-dock]');
  if (!dock || !active) return;

  const engine = active.engine;
  const ready = !!engine;
  const isAudio = active.dto.kind === 'audio';

  dock.innerHTML = `
    <button class="cd-btn ${engine?.muted ? 'off' : ''}" data-mic ${ready ? '' : 'disabled'} title="Mute">
      ${icon(engine?.muted ? 'micOff' : 'mic').outerHTML}</button>
    ${isAudio ? '' : `<button class="cd-btn ${engine?.cameraOff ? 'off' : ''}" data-cam ${ready ? '' : 'disabled'} title="Camera">
      ${icon(engine?.cameraOff ? 'camOff' : 'cam').outerHTML}</button>`}
    ${isAudio ? '' : `<button class="cd-btn" data-flip ${ready ? '' : 'disabled'} title="Switch camera">${icon('flip').outerHTML}</button>`}
    <button class="cd-btn ${engine?.sharing ? 'on' : ''}" data-share ${ready ? '' : 'disabled'} title="Share screen">
      ${icon('screen').outerHTML}</button>
    <button class="cd-btn" data-settings ${ready ? '' : 'disabled'} title="Devices">${icon('settings').outerHTML}</button>
    <button class="cd-btn end" data-hangup title="End call">${icon('phoneOff').outerHTML}</button>`;

  // NOTE: `event.currentTarget` is nulled once dispatch finishes, so it must be read
  // into a local before any `await`. Using it afterwards threw a TypeError and left the
  // button visually stuck even though the call state had changed.
  dock.querySelector('[data-mic]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!active?.engine) return;
    await active.engine.setMuted(!active.engine.muted);
    const muted = active.engine.muted;
    btn.classList.toggle('off', muted);
    btn.innerHTML = icon(muted ? 'micOff' : 'mic').outerHTML;
  });

  dock.querySelector('[data-cam]')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (!active?.engine) return;
    active.engine.setCameraOff(!active.engine.cameraOff);
    const off = active.engine.cameraOff;
    btn.classList.toggle('off', off);
    btn.innerHTML = icon(off ? 'camOff' : 'cam').outerHTML;
    layerRoot().querySelector('.cs-self-off')?.toggleAttribute('hidden', !off);
  });

  dock.querySelector('[data-flip]')?.addEventListener('click', () => {
    active?.engine?.switchCamera().catch(e => toast(e.message, 'err'));
  });

  dock.querySelector('[data-share]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!active?.engine) return;
    try {
      const on = await active.engine.toggleScreenShare();
      btn.classList.toggle('on', on);
    } catch (err) {
      if (err?.name !== 'NotAllowedError') toast(err.message || 'Screen share failed', 'err');
    }
  });

  dock.querySelector('[data-settings]')?.addEventListener('click', openDeviceSheet);
  dock.querySelector('[data-hangup]')?.addEventListener('click', hangUp);
}

async function openDeviceSheet() {
  const devices = await enumerate();
  const root = layerRoot();
  const existing = root.querySelector('.device-sheet');
  if (existing) { existing.remove(); return; }

  const sheet = h(`<div class="device-sheet">
    <div class="ds-head">Devices</div>
    <label class="ds-row"><span>Microphone</span>
      <select data-ds-mic>${devices.mics.map((d, i) =>
        `<option value="${esc(d.deviceId)}">${esc(d.label || `Microphone ${i + 1}`)}</option>`).join('')}</select></label>
    <label class="ds-row"><span>Camera</span>
      <select data-ds-cam>${devices.cameras.map((d, i) =>
        `<option value="${esc(d.deviceId)}">${esc(d.label || `Camera ${i + 1}`)}</option>`).join('')}</select></label>
    <p class="ds-note">Audio processing: echo cancellation, noise suppression and auto gain are on.</p>
  </div>`);
  root.querySelector('.call-stage')?.appendChild(sheet);
}

/* ────────────────────────── status + timer ─────────────────────────── */

function startTimer() {
  if (!active) return;
  active.startedAt = active.startedAt || Date.now();
  if (active.timerId) clearInterval(active.timerId);
  active.timerId = setInterval(updateStatus, 1000);
  updateStatus();
}

function updateStatus() {
  if (!active?.startedAt) return;
  const el = layerRoot().querySelector('[data-cs-status]');
  if (!el) return;
  const secs = Math.floor((Date.now() - active.startedAt) / 1000);
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  const peers = active.engine?.peers.size ?? 0;
  el.textContent = active.dto.isGroup && peers > 1
    ? `${mm}:${ss} · ${peers + 1} participants`
    : `${mm}:${ss}`;
}

async function startQualityPolling() {
  if (active?.qualityTimer) clearInterval(active.qualityTimer);
  const poll = async () => {
    if (!active?.engine) return;
    const results = await active.engine.quality();
    const pill = layerRoot().querySelector('[data-cs-quality]');
    if (!pill) return;
    if (!results.length) { pill.hidden = true; return; }
    const worst = results.some(r => r.level === 'poor') ? 'poor'
      : results.some(r => r.level === 'fair') ? 'fair'
      : results.every(r => r.level === 'unknown') ? 'unknown' : 'good';
    pill.hidden = false;
    pill.className = `cs-quality ${worst}`;
    // Stats need a few seconds of media before RTT is reported; don't cry "connecting"
    // at a call that is plainly up and running.
    const connected = Object.keys(active?.engine?.peers ?? {}).length === 0
      ? false
      : [...active.engine.peers.values()].every(p => p.pc.connectionState === 'connected');
    pill.textContent = worst === 'good' ? 'Good connection'
      : worst === 'fair' ? 'Unstable'
      : worst === 'poor' ? 'Poor connection'
      : connected ? 'Connected' : 'Connecting';
  };
  poll();
  if (active) active.qualityTimer = setInterval(poll, 5000);
}

async function togglePip() {
  const video = layerRoot().querySelector('.call-tile .ct-video') || layerRoot().querySelector('.cs-self video');
  if (!video) return;
  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await video.requestPictureInPicture();
  } catch {
    toast('Picture-in-picture is not available here', 'info');
  }
}

/* ────────────────────────── teardown ───────────────────────────────── */

async function hangUp() {
  if (!active) return;
  const hub = await connectCall();
  const { id, status } = active.dto;
  const isOutgoingPending = active.state === 'outgoing' || status === 'ringing';
  const isGroup = active.dto.isGroup;

  if (id && id !== 'pending') {
    if (isOutgoingPending) await hub?.invoke('CancelCall', id).catch(() => {});
    else if (isGroup) await hub?.invoke('LeaveCall', id).catch(() => {});
    else await hub?.invoke('EndCall', id).catch(() => {});
  }
  playEnded();
  teardown();
}

function teardown() {
  stopRing();
  if (active?.timerId) clearInterval(active.timerId);
  if (active?.qualityTimer) clearInterval(active.qualityTimer);
  active?.engine?.close();
  active = null;

  const root = layerRoot();
  root.classList.remove('open', 'incoming');
  root.innerHTML = '';
  window.dispatchEvent(new CustomEvent('sc:call-ended'));
}

/* ────────────────────────── call history ───────────────────────────── */

export async function renderCallHistory(container) {
  container.innerHTML = `<div class="spinner"></div>`;
  let rows = [];
  try { rows = await api.callHistory(); } catch { rows = []; }

  if (!rows.length) {
    container.innerHTML = `<div class="empty-state">
      <div class="es-art">${icon('phone').outerHTML}</div>
      <h3>No calls yet</h3><p>Start one from a chat or a profile — video and audio both work.</p></div>`;
    return;
  }

  container.innerHTML = '';
  const groups = new Map();
  for (const r of rows) {
    const day = new Date(r.startedAt).toDateString();
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(r);
  }

  for (const [day, items] of groups) {
    container.appendChild(h(`<div class="call-day">${esc(dayLabel(day))}</div>`));
    for (const r of items) {
      const missed = r.wasMissed;
      const row = h(`<div class="call-row">
        ${avatar(r.peerName, 46, r.peerAvatarUrl).outerHTML}
        <div class="cr-main">
          <div class="cr-name ${missed ? 'missed' : ''}">${esc(r.peerName)}</div>
          <div class="cr-sub">
            <span class="cr-dir">${icon(r.direction === 'outgoing' ? 'arrowUpRight' : 'arrowDownLeft').outerHTML}</span>
            ${missed ? 'Missed' : r.durationSeconds ? fmtDuration(r.durationSeconds) : esc(r.status)}
            · ${r.kind === 'video' ? 'Video' : 'Audio'} · ${timeAgo(r.startedAt)}
          </div>
        </div>
        <button class="cr-call" data-call title="${r.kind === 'video' ? 'Video call' : 'Audio call'}">
          ${icon(r.kind === 'video' ? 'cam' : 'phone').outerHTML}</button>
      </div>`);

      row.querySelector('[data-call]').addEventListener('click', () => {
        if (r.peerId) startCall(r.peerId, r.kind === 'video' ? 'video' : 'audio', r.peerName);
      });
      container.appendChild(row);
    }
  }
}

function dayLabel(day) {
  const d = new Date(day);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtDuration(s) {
  const m = Math.floor(s / 60), sec = s % 60;
  return m ? `${m}m ${sec}s` : `${sec}s`;
}
