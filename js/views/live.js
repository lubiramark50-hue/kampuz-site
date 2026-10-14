/* StreamCampus — Live: browse rooms, host with webcam, watch via WebRTC */
import { api, session } from '../api.js';
import { esc, h, icon, timeAgo, avatar, toast, emptyState, fmtCount } from '../ui.js';
import { connectLive, liveHub, disconnectLive } from '../realtime.js';

export async function renderLive(root) {
  root.innerHTML = '';
  const el = h(`<div>
    <div class="page-head">
      <h1>Live</h1><span class="grow"></span>
      <button class="btn btn-primary" data-golive>${icon('radio').outerHTML} Go live</button>
    </div>
    <p class="ph-sub" style="margin:-6px 0 16px">Real classrooms, real time — lectures, revision sessions and campus events.</p>
    <div class="live-grid" id="rooms"><div class="spinner"></div></div>
  </div>`);
  root.appendChild(el);

  el.querySelector('[data-golive]').addEventListener('click', () => goLiveDialog(root));

  const rooms = await api.liveRooms().catch(() => []);
  const box = el.querySelector('#rooms');
  box.innerHTML = '';
  if (!rooms.length) {
    box.appendChild(emptyState('radio', 'No one is live right now', 'Start the first campus stream — a revision hour, a club meeting, or your talent show.',
      `<button class="btn btn-primary" data-golive2>Start streaming</button>`));
    box.querySelector('[data-golive2]')?.addEventListener('click', () => goLiveDialog(root));
    return;
  }
  rooms.forEach(r => box.appendChild(liveCard(r)));
}

function liveCard(room) {
  const el = h(`<div class="card live-card">
    <div class="live-thumb">
      <span class="lt-emoji">📺</span>
      <span class="live-badge"><i></i>LIVE</span>
      <span class="live-viewers">${icon('eye').outerHTML} ${fmtCount(room.viewerCount)}</span>
    </div>
    <div class="live-card-body">
      ${avatar(room.hostName, 40, room.hostAvatarUrl).outerHTML}
      <div style="min-width:0">
        <div class="lcb-title">${esc(room.title)}</div>
        <div class="lcb-host">${esc(room.hostName)}${room.courseName ? ` · ${esc(room.courseName)}` : ''}</div>
      </div>
    </div>
  </div>`);
  el.addEventListener('click', () => watchRoom(room));
  return el;
}

/* ───────────────────────── go live ───────────────────────── */
async function goLiveDialog(root) {
  const { openModal } = await import('../ui.js');
  const courses = await api.myCourses().catch(() => []);

  const { modal, close } = openModal({
    title: 'Go live on campus',
    body: `
      <div style="border-radius:14px;overflow:hidden;background:#000;aspect-ratio:16/9;display:grid;place-items:center" id="live-preview">
        <p style="color:#94a3b8;font-size:13px">Camera preview will appear here</p>
      </div>
      <div class="field"><label>Stream title</label>
        <input class="input" name="title" placeholder="e.g. CSC2101 exam revision hour" maxlength="100"></div>
      <div class="field"><label>Attach to a course (optional)</label>
        <select class="input" name="courseId"><option value="">— open campus stream —</option>
          ${courses.map(c => `<option value="${esc(c.id)}">${esc(c.code)} — ${esc(c.name)}</option>`).join('')}
        </select></div>
      <p class="hint" style="color:var(--text-3);font-size:12.5px">Your followers and coursemates get notified the moment you go live.</p>`,
    footer: `<button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn btn-primary" data-start>${icon('radio').outerHTML} Start stream</button>`,
  });

  let stream = null;
  modal.parentElement.querySelector('[data-cancel]').addEventListener('click', () => {
    stream?.getTracks().forEach(t => t.stop());
    close();
  });

  // camera preview
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const preview = modal.querySelector('#live-preview');
    preview.innerHTML = '';
    const v = document.createElement('video');
    v.srcObject = stream; v.muted = true; v.autoplay = true; v.playsInline = true;
    v.style.cssText = 'width:100%;height:100%;object-fit:cover';
    preview.appendChild(v);
  } catch {
    modal.querySelector('#live-preview').innerHTML = `<p style="color:#f59e0b;font-size:13px;padding:16px;text-align:center">Camera not available — you can still host with audio/screen off, or watch as a viewer.</p>`;
  }

  modal.parentElement.querySelector('[data-start]').addEventListener('click', async () => {
    const title = modal.querySelector('[name=title]').value.trim() || 'Untitled stream';
    const courseId = modal.querySelector('[name=courseId]').value || null;
    try {
      const room = await api.createRoom(title, courseId);
      // Do NOT stop the preview stream here: it is the stream we are about to broadcast.
      // Stopping it left hostRoom with a dead MediaStream (tracks readyState "ended"),
      // so the host published no media at all and every viewer saw an empty player.
      close();
      hostRoom(room, stream);
    } catch (e) { toast(e.message, 'err'); }
  });
}

/* ───────────────────────── host side ─────────────────────── */
async function hostRoom(room, existingStream) {
  const stage = h(`<div class="live-stage">
    <div class="live-video-wrap">
      <video muted autoplay playsinline></video>
      <div class="live-top-bar">
        <button class="icon-btn" data-exit style="background:rgba(255,255,255,.15);color:#fff">${icon('x').outerHTML}</button>
        <span class="live-badge"><i></i>LIVE</span>
        <div style="margin-left:auto;text-align:right">
          <div style="font-weight:800">${esc(room.title)}</div>
          <div style="font-size:12.5px;opacity:.85"><span data-viewers>0</span> watching · you are hosting</div>
        </div>
      </div>
      <div class="live-controls">
        <button class="icon-btn" data-mic title="Mute mic">${icon('mic').outerHTML}</button>
        <button class="icon-btn" data-cam title="Camera off">${icon('cam').outerHTML}</button>
        <button class="icon-btn danger" data-end title="End stream">${icon('phone').outerHTML}</button>
      </div>
    </div>
    <div class="live-side">
      <div class="chat-head"><div class="ch-name">Live chat</div></div>
      <div class="chat-msgs"></div>
      <div class="chat-input-row">
        <input placeholder="Say something…" maxlength="300">
        <button class="btn btn-primary" aria-label="Send" style="width:46px;height:46px;padding:0;border-radius:50%">${icon('send').outerHTML}</button>
      </div>
    </div>
  </div>`);
  document.body.appendChild(stage);

  const hub = await connectLive();
  if (!hub) { toast('Live service unavailable', 'err'); stage.remove(); return; }

  const localVideo = stage.querySelector('video');
  let stream = existingStream;
  try {
    // Reuse the dialog's preview only if it is still alive; otherwise acquire fresh.
    const reusable = stream && stream.getTracks().some(t => t.readyState === 'live');
    stream = reusable ? stream : await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = stream;
    await localVideo.play().catch(() => {});
  } catch {
    localVideo.replaceWith(h(`<div style="color:#94a3b8;text-align:center;padding:20px"><p style="font-size:17px;font-weight:700;color:#fff">${esc(room.title)}</p><p style="font-size:13px;margin-top:6px">Camera unavailable — viewers can still hear chat & see you listed as live.</p></div>`));
  }

  // peer connections per viewer
  const peers = new Map();
  const makePeer = async (viewerConnId) => {
    if (!stream) return;

    // The host is told about a viewer twice: once when `JoinRoom` registers them and
    // again when the viewer calls `RequestOffer`. Building a second peer connection for
    // the same connection id replaced the first in the map, so the viewer's answer was
    // applied to the wrong peer and ICE never completed. Reuse the existing one.
    const existing = peers.get(viewerConnId);
    if (existing && existing.signalingState !== 'closed') {
      if (existing.connectionState === 'connected') return;
      // Still negotiating — nudge it rather than starting over.
      if (existing.localDescription) {
        await hub.invoke('SendOffer', room.roomSid, viewerConnId,
          JSON.stringify(existing.localDescription)).catch(() => {});
        return;
      }
      return;
    }

    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    pc.onicecandidate = e => { if (e.candidate) hub.invoke('SendIceCandidate', room.roomSid, viewerConnId, JSON.stringify(e.candidate)).catch(() => {}); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        peers.delete(viewerConnId);
        try { pc.close(); } catch { /* already closing */ }
        makePeer(viewerConnId).catch(() => {});
      }
    };
    // Register BEFORE sending the offer: the answer can come back while the offer
    // round-trip is still in flight, and a peer that is not in the map yet is dropped.
    peers.set(viewerConnId, pc);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await hub.invoke('SendOffer', room.roomSid, viewerConnId, JSON.stringify(offer)).catch(() => {});
  };

  hub.on('viewerJoined', async (connId) => { await makePeer(connId); });
  hub.on('answer', async (sdpJson, connId) => {
    const pc = peers.get(connId);
    if (pc) await pc.setRemoteDescription(JSON.parse(sdpJson)).catch(() => {});
  });
  hub.on('iceCandidate', async (candidateJson, connId) => {
    const pc = peers.get(connId);
    if (pc) await pc.addIceCandidate(JSON.parse(candidateJson)).catch(() => {});
  });
  hub.on('viewerCount', (n) => { stage.querySelector('[data-viewers]').textContent = n; });
  hub.on('liveChat', (m) => appendLiveChat(stage, m, session.user.id));
  hub.on('hostDisconnected', () => {});

  await hub.invoke('JoinRoom', room.roomSid).catch(() => {});

  // controls
  let micOn = true, camOn = true;
  stage.querySelector('[data-mic]').addEventListener('click', (e) => {
    micOn = !micOn;
    stream?.getAudioTracks().forEach(t => t.enabled = micOn);
    e.currentTarget.classList.toggle('off', !micOn);
    e.currentTarget.innerHTML = icon(micOn ? 'mic' : 'micOff').outerHTML;
  });
  stage.querySelector('[data-cam]').addEventListener('click', (e) => {
    camOn = !camOn;
    stream?.getVideoTracks().forEach(t => t.enabled = camOn);
    e.currentTarget.classList.toggle('off', !camOn);
    e.currentTarget.innerHTML = icon(camOn ? 'cam' : 'camOff').outerHTML;
  });

  const end = async () => {
    peers.forEach(pc => pc.close());
    peers.clear();
    stream?.getTracks().forEach(t => t.stop());
    await api.endRoom(room.roomSid).catch(() => {});
    await hub.invoke('LeaveRoom', room.roomSid).catch(() => {});
    stage.remove();
    toast('Stream ended', 'info');
  };
  stage.querySelector('[data-end]').addEventListener('click', end);
  stage.querySelector('[data-exit]').addEventListener('click', end);

  wireLiveChat(stage, room, (text) => hub.invoke('SendLiveChat', room.roomSid, text));

  // cleanup on nav
  new MutationObserver((_, obs) => {
    if (!document.body.contains(stage)) {
      peers.forEach(pc => pc.close());
      stream?.getTracks().forEach(t => t.stop());
      obs.disconnect();
    }
  }).observe(document.body, { childList: true, subtree: true });
}

/* ───────────────────────── viewer side ───────────────────── */
async function watchRoom(room) {
  const stage = h(`<div class="live-stage">
    <div class="live-video-wrap">
      <video autoplay playsinline></video>
      <div style="position:absolute;inset:0;display:grid;place-items:center;color:#94a3b8" data-wait>
        <div style="text-align:center;display:grid;gap:8px;justify-items:center">
          <div class="spinner" style="border-top-color:#F59E0B"></div>
          <p style="font-size:14px">Connecting to the stream…</p>
        </div>
      </div>
      <div class="live-top-bar">
        <button class="icon-btn" data-exit style="background:rgba(255,255,255,.15);color:#fff">${icon('x').outerHTML}</button>
        <span class="live-badge"><i></i>LIVE</span>
        <div style="margin-left:auto;text-align:right">
          <div style="font-weight:800">${esc(room.title)}</div>
          <div style="font-size:12.5px;opacity:.85"><span data-viewers>${room.viewerCount}</span> watching · ${esc(room.hostName)}</div>
        </div>
      </div>
    </div>
    <div class="live-side">
      <div class="chat-head"><div class="ch-name">Live chat</div></div>
      <div class="chat-msgs"></div>
      <div class="chat-input-row">
        <input placeholder="Say something…" maxlength="300">
        <button class="btn btn-primary" aria-label="Send" style="width:46px;height:46px;padding:0;border-radius:50%">${icon('send').outerHTML}</button>
      </div>
    </div>
  </div>`);
  document.body.appendChild(stage);

  const hub = await connectLive();
  if (!hub) { toast('Live service unavailable', 'err'); stage.remove(); return; }

  const video = stage.querySelector('video');
  const waitBox = stage.querySelector('[data-wait]');

  // Declared before the peer connection so its callbacks can safely reference it.
  const liveState = { room: room.roomSid, tracks: [] };

  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  pc.ontrack = (e) => {
    // `streams[0]` is present for a normal sendrecv offer; fall back to a stream built
    // from the track so a browser that omits it still renders.
    video.srcObject = e.streams[0] || new MediaStream([e.track]);
    video.play().catch(() => {});
    waitBox.style.display = 'none';
    liveState.tracks = (video.srcObject?.getTracks() || []).map(t => t.kind);
  };
  pc.onicecandidate = e => { if (e.candidate) hub.invoke('SendIceCandidate', room.roomSid, null, JSON.stringify(e.candidate)).catch(() => {}); };
  pc.onconnectionstatechange = () => { liveState.connectionState = pc.connectionState; };
  pc.oniceconnectionstatechange = () => { liveState.iceConnectionState = pc.iceConnectionState; };

  // NOTE: do NOT pre-create recvonly transceivers here. A viewer never sends media, and
  // adding them locally fixes the m-line order to whatever we add first — while the
  // host's offer orders audio before video. Chrome then binds the offer's m-lines to our
  // transceivers positionally, swapping audio and video, and no frame ever decodes.
  // Receivers are created automatically when the offer is applied.

  window.__scLiveState = () => ({
    ...liveState,
    connectionState: pc.connectionState,
    iceConnectionState: pc.iceConnectionState,
    signalingState: pc.signalingState,
    videoWidth: video.videoWidth,
    videoHeight: video.videoHeight,
    currentTime: video.currentTime,
  });

  // ICE that lands before the remote description exists would be rejected and lost,
  // which leaves the peer stuck in "checking". Buffer and replay instead.
  const pendingIce = [];
  const drainIce = async () => {
    while (pendingIce.length) {
      const next = pendingIce.shift();
      await pc.addIceCandidate(next).catch(err => console.debug('[live] ice add failed', err?.message));
    }
  };

  let answered = false;

  hub.on('offer', async (sdpJson) => {
    // The host offers twice for a new viewer (once when it sees `viewerJoined`, once
    // because the viewer also calls `RequestOffer`). Answering the second one while
    // already stable threw "Called in wrong state: stable" and aborted the handshake.
    if (answered || pc.signalingState !== 'stable') return;
    answered = true;

    try {
      await pc.setRemoteDescription(JSON.parse(sdpJson));
      await drainIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await hub.invoke('SendAnswer', room.roomSid, JSON.stringify(pc.localDescription));
    } catch (err) {
      answered = false;
      // Swallowing this used to leave the viewer on "Connecting…" forever with no clue.
      console.error('[live] offer handling failed', err);
      toast('Could not connect to the stream', 'err');
    }
  });

  hub.on('iceCandidate', async (candidateJson) => {
    let candidate;
    try { candidate = JSON.parse(candidateJson); } catch { return; }
    if (!pc.remoteDescription) { pendingIce.push(candidate); return; }
    await pc.addIceCandidate(candidate).catch(err => console.debug('[live] ice add failed', err?.message));
  });
  hub.on('viewerCount', (n) => { stage.querySelector('[data-viewers]').textContent = n; });
  hub.on('liveChat', (m) => appendLiveChat(stage, m, session.user.id));
  hub.on('hostDisconnected', () => {
    toast('The host ended the stream', 'info');
    pc.close(); stage.remove();
  });

  await hub.invoke('JoinRoom', room.roomSid).catch(() => {});
  // ask host for an offer (covers joining before/after host publish)
  await hub.invoke('RequestOffer', room.roomSid).catch(() => {});

  const exit = async () => {
    pc.close();
    await hub.invoke('LeaveRoom', room.roomSid).catch(() => {});
    stage.remove();
  };
  stage.querySelector('[data-exit]').addEventListener('click', exit);

  wireLiveChat(stage, room, (text) => hub.invoke('SendLiveChat', room.roomSid, text));

  new MutationObserver((_, obs) => {
    if (!document.body.contains(stage)) { pc.close(); obs.disconnect(); }
  }).observe(document.body, { childList: true, subtree: true });
}

/* ───────────────────────── live chat shared ──────────────── */
function wireLiveChat(stage, room, sendFn) {
  const input = stage.querySelector('.chat-input-row input');
  const btn = stage.querySelector('.chat-input-row .btn');
  const doSend = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try { await sendFn(text); } catch { toast('Message failed', 'err'); }
  };
  btn.addEventListener('click', doSend);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });
}

function appendLiveChat(stage, m, myId) {
  const box = stage.querySelector('.live-side .chat-msgs');
  if (!box || !m) return;
  const mine = m.userId === myId;
  box.appendChild(h(`<div class="msg-row ${mine ? 'mine' : ''}" style="max-width:92%">
    ${mine ? '' : avatar(m.name, 28).outerHTML}
    <div>
      ${!mine ? `<div class="msg-sender">${esc(m.name)}</div>` : ''}
      <div class="msg-bubble" style="background:${mine ? 'var(--grad-brand)' : 'rgba(255,255,255,.08)'};color:${mine ? '#fff' : 'var(--text)'}">
        <div class="msg-text">${esc(m.content)}</div>
        <div class="msg-time">now</div>
      </div>
    </div>
  </div>`));
  box.scrollTop = box.scrollHeight;
}
