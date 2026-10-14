/* StreamCampus — SignalR realtime (chat hub + live hub) */
import { session } from './api.js';

let chatConn = null;
let liveConn = null;
let callConn = null;
let callConnId = null;

/* A hub that answers 404/405/501 does not exist on this backend yet. Without a gate every caller
   (presence, components, course groups) retried a fresh negotiation, flooding the console and network. */
const down = {};
const isDown = (name) => !!down[name] && Date.now() < down[name].until;
function markDown(name, err) {
  const permanent = /\b(404|405|501)\b/.test(String(err?.message || err));
  const fails = (down[name]?.fails || 0) + 1;
  down[name] = { fails, until: Date.now() + (permanent ? 600000 : Math.min(15000 * 2 ** (fails - 1), 300000)) };
  window.dispatchEvent(new CustomEvent('kz:realtime-down', { detail: { hub: name, permanent } }));
}
const markUp = (name) => { delete down[name]; };

const qs = (url) => {
  const t = session.token;
  return t ? `${url}?access_token=${encodeURIComponent(t)}` : url;
};

/** Chat hub: notifications + direct/course messaging + typing */
export async function connectChat() {
  if (chatConn) return chatConn;
  if (isDown('chat')) return null;
  chatConn = new signalR.HubConnectionBuilder()
    .withUrl(qs('/hubs/chat'))
    .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
    .configureLogging(signalR.LogLevel.Error)
    .build();

  chatConn.onreconnected(async () => {
    // rejoin any course groups the app had open
    for (const cid of joinedCourses) await chatConn.invoke('JoinCourse', cid).catch(() => {});
    window.dispatchEvent(new CustomEvent('sc:reconnected'));
  });

  await chatConn.start().then(() => markUp('chat')).catch(err => {
    console.warn('chat hub offline:', err?.message);
    markDown('chat', err);
    chatConn = null;
    return null;
  });
  return chatConn;
}

export function chatHub() { return chatConn; }

/** SignalR connection id for the chat hub — used by the mesh to identify peers. */
export function chatConnectionId() { return chatConn?.connectionId || null; }

export async function disconnectChat() {
  if (chatConn) { try { await chatConn.stop(); } catch {} chatConn = null; }
}

const joinedCourses = new Set();

export async function joinCourseGroup(courseId) {
  joinedCourses.add(courseId);
  const c = await connectChat();
  if (c) await c.invoke('JoinCourse', courseId).catch(() => {});
}

export async function leaveCourseGroup(courseId) {
  joinedCourses.delete(courseId);
  if (chatConn) await chatConn.invoke('LeaveCourse', courseId).catch(() => {});
}

/* ───────── live hub (WebRTC signaling) ───────── */
export async function connectLive() {
  if (liveConn) return liveConn;
  if (isDown('live')) return null;
  liveConn = new signalR.HubConnectionBuilder()
    .withUrl(qs('/hubs/live'))
    .configureLogging(signalR.LogLevel.Error)
    .build();
  await liveConn.start().then(() => markUp('live')).catch(err => { console.warn('live hub offline:', err?.message); markDown('live', err); liveConn = null; });
  return liveConn;
}

export async function disconnectLive() {
  if (liveConn) { try { await liveConn.stop(); } catch {} liveConn = null; }
}

export function liveHub() { return liveConn; }

/* ───────── call hub (WebRTC signalling for audio/video calls) ─────────
 * Connected for every signed-in user so an incoming ring can arrive on any screen. */
export async function connectCall() {
  if (callConn && callConn.state === 'Connected') return callConn;
  if (isDown('call')) return null;

  if (!callConn) {
    callConn = new signalR.HubConnectionBuilder()
      .withUrl(qs('/hubs/call'))
      .withAutomaticReconnect([0, 1500, 4000, 8000, 20000, 30000])
      .configureLogging(signalR.LogLevel.Error)
      .build();

    callConn.onreconnected(() => {
      callConnId = callConn.connectionId;
      window.dispatchEvent(new CustomEvent('sc:reconnected'));
    });
  }

  if (callConn.state === 'Disconnected') {
    try {
      await callConn.start();
      markUp('call');
      callConnId = callConn.connectionId;
    } catch (err) {
      console.warn('call hub offline:', err?.message);
      markDown('call', err);
      callConn = null;
      return null;
    }
  }
  return callConn;
}

export function callHub() { return callConn; }
export function callConnectionId() { return callConnId || callConn?.connectionId || null; }

export async function disconnectCall() {
  if (callConn) { try { await callConn.stop(); } catch {} callConn = null; callConnId = null; }
}

/* ───────── app usage heartbeat ───────── */
import { api } from './api.js';

let beatTimer = null;
let beatStart = null;

export function startUsageHeartbeat() {
  stopUsageHeartbeat();
  beatStart = new Date();
  beatTimer = setInterval(sendBeat, 60_000);
  document.addEventListener('visibilitychange', onVisibility);
}

function onVisibility() {
  if (document.visibilityState === 'hidden') sendBeat();
  else beatStart = new Date();
}

function sendBeat() {
  if (!beatStart || document.visibilityState === 'hidden') return;
  const end = new Date();
  const secs = (end - beatStart) / 1000;
  beatStart = end;
  if (secs < 15) return; // ignore tiny blips
  if (session.isLoggedIn) {
    api.usageSession(beatStart.toISOString(), end.toISOString()).catch(() => {});
  }
}

export function stopUsageHeartbeat() {
  if (beatTimer) clearInterval(beatTimer);
  beatTimer = null;
  document.removeEventListener('visibilitychange', onVisibility);
}
