/* StreamCampus — shared online/offline state.
 * Seeded by a batch hub call, then kept fresh by `presenceChanged` pushes. */

import { connectChat, chatHub, connectCall, callHub } from './realtime.js';

const online = new Set();
const listeners = new Set();
let wired = false;

export function isOnline(userId) {
  return !!userId && online.has(userId);
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(userId, state) {
  for (const fn of listeners) {
    try { fn(userId, state); } catch { /* a bad listener must not break the rest */ }
  }
}

/** Seed presence for a list of user ids (conversation partners, profile header, …). */
export async function hydrate(userIds = []) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Set(online);

  await wire();
  const hub = chatHub() || await connectChat();
  if (!hub) return new Set(online);

  try {
    const result = await hub.invoke('GetOnlineUsers', ids);
    for (const id of result || []) {
      if (!online.has(id)) { online.add(id); emit(id, true); }
    }
    // Anything we asked about that is absent is definitively offline.
    for (const id of ids) {
      if (!result?.includes(id) && online.has(id)) { online.delete(id); emit(id, false); }
    }
  } catch { /* presence is best-effort */ }
  return new Set(online);
}

/** Subscribe to presence pushes. Idempotent — safe to await on every view render. */
export async function wire() {
  if (wired) return;
  wired = true;

  const handle = ({ userId, online: up }) => {
    const was = online.has(userId);
    if (up) online.add(userId); else online.delete(userId);
    if (was !== up) emit(userId, up);
  };

  const chat = await connectChat();
  chat?.on('presenceChanged', handle);

  // The call hub owns the connection lifecycle that fires presence changes.
  const call = await connectCall();
  call?.on('presenceChanged', handle);
}
