/* Gen Z — client API with auth, token refresh, contract adapters and graceful degradation */

const BASE = 'https://rentpay.site';
const store = {
  access: null, refresh: null, user: null,
};

const KEYS = { access: 'sc_access', refresh: 'sc_refresh', user: 'sc_user', theme: 'sc_theme' };

export function loadSession() {
  store.access = localStorage.getItem(KEYS.access);
  store.refresh = localStorage.getItem(KEYS.refresh);
  try { store.user = JSON.parse(localStorage.getItem(KEYS.user)); } catch { store.user = null; }
}

export function saveSession(authResult) {
  store.access = authResult.accessToken;
  store.refresh = authResult.refreshToken;
  store.user = {
    id: authResult.userId, email: authResult.email, fullName: authResult.fullName,
  };
  localStorage.setItem(KEYS.access, store.access);
  localStorage.setItem(KEYS.refresh, store.refresh);
  localStorage.setItem(KEYS.user, JSON.stringify(store.user));
}

export function clearSession() {
  store.access = store.refresh = null; store.user = null;
  [KEYS.access, KEYS.refresh, KEYS.user].forEach(k => localStorage.removeItem(k));
}

export const session = {
  get token() { return store.access; },
  get user() { return store.user; },
  get isLoggedIn() { return !!store.access; },
  setUser(u) { store.user = u; localStorage.setItem(KEYS.user, JSON.stringify(u)); },
};

/* ───────── theme ───────── */
export function getTheme() { return localStorage.getItem(KEYS.theme) || 'dark'; }
export function setTheme(t) {
  localStorage.setItem(KEYS.theme, t);
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'dark' ? '#0b0d12' : '#f6f7f9');
}

/* ───────── low-level fetch ───────── */
let refreshing = null;

async function rawFetch(path, options = {}, retried = false) {
  const headers = { ...(options.headers || {}) };
  if (store.access && !options.noAuth) headers['Authorization'] = `Bearer ${store.access}`;
  if (options.body && !(options.body instanceof FormData) && typeof options.body === 'string') {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  let res;
  try {
    res = await fetch(BASE + path, { ...options, headers });
  } catch {
    throw Object.assign(new Error('Network unreachable — is the server running?'), { status: 0 });
  }

  // one transparent refresh attempt on 401
  if (res.status === 401 && store.refresh && !retried && !options.noAuth) {
    refreshing = refreshing || doRefresh();
    const ok = await refreshing;
    refreshing = null;
    if (ok) return rawFetch(path, options, true);
    clearSession();
    window.dispatchEvent(new CustomEvent('sc:logout'));
  }
  return res;
}

async function doRefresh() {
  try {
    const res = await fetch(BASE + '/api/Auth/refresh-token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: store.refresh }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data.succeeded) return false;
    store.access = data.accessToken; store.refresh = data.refreshToken;
    localStorage.setItem(KEYS.access, store.access);
    localStorage.setItem(KEYS.refresh, store.refresh);
    return true;
  } catch { return false; }
}

async function handle(res) {
  if (res.status === 204 || res.status === 200 && res.headers.get('content-length') === '0') return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = res.status === 501 ? 'This feature is rolling out soon.' :
      (data && (data.error || data.errorMessage || data.title)) ||
      (typeof data === 'string' && data) || `Request failed (${res.status})`;
    throw Object.assign(new Error(msg), { status: res.status, data });
  }
  return data;
}

/* ───────── resilience + contract adapters ─────────
   The edge backend (Cloudflare Worker + Supabase) is migrating slice by slice. Until a slice lands
   its routes answer 501 NOT_MIGRATED or 404 NO_ROUTE. Read-only list endpoints then degrade to an
   empty result instead of painting an error card, and the user hears about it once. The moment the
   backend implements a route, its real response flows through untouched. */
const SOFT_EMPTY = [
  [/^\/api\/Users\/suggested/, () => []],
  [/^\/api\/Users\/[^/]+\/(followers|following)/, () => []],
  [/^\/api\/Courses\/(all|my-courses)/, () => []],
  [/^\/api\/Feed\//, () => []],
  [/^\/api\/Hashtags\/trending/, () => []],
  [/^\/api\/Notifications\/unread-count/, () => ({ count: 0 })],
  [/^\/api\/Notifications/, () => []],
  [/^\/api\/Chat\/unread-count/, () => ({ count: 0 })],
  [/^\/api\/Chat\/(conversations|search)/, () => []],
  [/^\/api\/Search\//, () => []],
  [/^\/api\/LiveStream$/, () => []],
  [/^\/api\/Call\/history/, () => []],
  [/^\/api\/Call\/missed-count/, () => ({ count: 0 })],
  [/^\/api\/Ads$/, () => []],
  [/^\/api\/AppTimer\/summary/, () => ({ totalMinutesToday: 0, dailyLimitMinutes: null, limitExceeded: false })],
  [/^\/api\/Subscription\/status/, () => ({ isActive: false })],
  [/^\/api\/Posts\/(bookmarked|user\/)/, () => []],
  [/^\/api\/AI\/providers/, () => []],
];

function softEmpty(path) {
  const clean = path.split('?')[0] + (path.includes('?') ? '?' : '');
  for (const [re, make] of SOFT_EMPTY) {
    if (!re.test(clean)) continue;
    const value = make();
    // Views can tell "genuinely empty" from "not built yet" via value.degraded.
    Object.defineProperty(value, 'degraded', { value: true, enumerable: false });
    return value;
  }
  return undefined;
}

function noteDegraded(path) {
  const seen = (window.__kzDegraded = window.__kzDegraded || new Set());
  const first = seen.size === 0;
  const bare = path.split('?')[0];
  seen.add(bare);
  window.dispatchEvent(new CustomEvent('kz:degraded-path', { detail: { path: bare } }));
  if (first) window.dispatchEvent(new CustomEvent('kz:degraded'));
}

/* The edge API names fields differently from the original contract the UI was built on
   (body/author/handle vs content/user/universityEmail). Normalise once, here. */
const asUser = (u) => (!u || typeof u !== 'object') ? u : {
  ...u,
  fullName: u.fullName || u.handle || 'Student',
  universityEmail: u.universityEmail || u.email || u.handle || '',
  bio: u.bio ?? null, avatarUrl: u.avatarUrl ?? null,
  followersCount: u.followersCount ?? 0, followingCount: u.followingCount ?? 0,
  postCount: u.postCount ?? 0, isAdFree: !!u.isAdFree,
};

const asPost = (p) => {
  if (!p || typeof p !== 'object' || p.user || !('body' in p || 'author' in p)) return p;
  const kind = String(p.mediaType || '').toLowerCase();
  return {
    ...p,
    content: p.content ?? p.body ?? '',
    type: kind === 'video' ? 'Video' : kind === 'image' ? 'Image' : 'Text',
    user: asUser(p.author || {}),
    thumbnailUrl: p.thumbnailUrl ?? null, durationSeconds: p.durationSeconds ?? 0,
    courseId: p.courseId ?? null, courseName: p.courseName ?? null,
    likeCount: p.likeCount ?? 0, commentCount: p.commentCount ?? 0,
    isLikedByCurrentUser: !!p.isLikedByCurrentUser, isBookmarkedByCurrentUser: !!p.isBookmarkedByCurrentUser,
  };
};

const asComment = (c) => (c && typeof c === 'object') ? { ...c, content: c.content ?? c.text ?? '', user: asUser(c.user) } : c;

function adapt(path, method, data) {
  if (data == null) return data;
  const bare = path.split('?')[0];

  if (method === 'POST') {
    if (bare === '/api/Posts') return asPost(data);
    if (/^\/api\/Posts\/[^/]+\/comments$/.test(bare)) return asComment(data);
    return data;
  }
  if (method !== 'GET') return data;

  if (/^\/api\/Users\/(me|[0-9a-f]{8}-[0-9a-f-]{27})$/i.test(bare)) return asUser(data);
  if (/^\/api\/(Users\/(suggested|search)|Search\/users)$|^\/api\/Users\/[0-9a-f-]{36}\/(followers|following)$/i.test(bare)) {
    return Array.isArray(data) ? data.map(asUser) : data;
  }
  if (/^\/api\/Posts\/[^/]+\/comments$/.test(bare)) return Array.isArray(data) ? data.map(asComment) : data;
  if (/^\/api\/(Feed\/|Posts\/|Search\/posts$)/.test(bare)) return Array.isArray(data) ? data.map(asPost) : asPost(data);
  return data;
}

async function json(path, options) {
  const method = String(options?.method || 'GET').toUpperCase();
  let res = await rawFetch(path, options);
  // Upstream hiccups (502/503/504) on a read are worth one more try before we show an error.
  if (method === 'GET' && [502, 503, 504].includes(res.status)) {
    await new Promise(r => setTimeout(r, 500));
    res = await rawFetch(path, options);
  }
  if (method === 'GET' && (res.status === 501 || res.status === 404)) {
    const peek = await res.clone().json().catch(() => null);
    if (peek && (peek.code === 'NOT_MIGRATED' || peek.code === 'NO_ROUTE')) {
      // The edge API has no per-user route yet; your own profile is the one case /me can answer.
      const own = path.match(/^\/api\/Users\/([0-9a-f-]{36})$/i);
      if (own && store.user && store.user.id === own[1]) return adapt('/api/Users/me', 'GET', await handle(await rawFetch('/api/Users/me')));
      const soft = softEmpty(path);
      if (soft !== undefined) { noteDegraded(path); return soft; }
    }
  }
  return adapt(path, method, await handle(res));
}

/* ───────────────────────── API surface ───────────────────── */
export const api = {
  /* auth */
  register: (b) => json('/api/Auth/register', { method: 'POST', body: JSON.stringify(b), noAuth: true }),
  login: (b) => json('/api/Auth/login', { method: 'POST', body: JSON.stringify(b), noAuth: true }),
  logout: () => json('/api/Auth/logout', { method: 'POST' }),

  /* users */
  me: () => json('/api/Users/me'),
  user: (id) => json(`/api/Users/${id}`),
  suggested: (count = 5) => json(`/api/Users/suggested?count=${count}`),
  updateProfile: (b) => json('/api/Users', { method: 'PUT', body: JSON.stringify(b) }),
  uploadAvatar: (file) => {
    const fd = new FormData(); fd.append('file', file);
    return json('/api/Users/avatar', { method: 'POST', body: fd });
  },
  isFollowing: (id) => json(`/api/Users/${id}/is-following`),
  follow: (id) => json(`/api/Users/${id}/follow`, { method: 'POST' }),
  unfollow: (id) => json(`/api/Users/${id}/follow`, { method: 'DELETE' }),
  followers: (id, page = 1) => json(`/api/Users/${id}/followers?page=${page}`),
  following: (id, page = 1) => json(`/api/Users/${id}/following?page=${page}`),

  /* posts */
  createPost: ({ content, type, mediaFile, thumbnailFile, courseId, isShort, durationSeconds }) => {
    const fd = new FormData();
    fd.append('Content', content);
    fd.append('Type', type);
    if (mediaFile) fd.append('MediaFile', mediaFile);
    if (thumbnailFile) fd.append('ThumbnailFile', thumbnailFile);
    if (courseId) fd.append('CourseId', courseId);
    if (isShort) fd.append('IsShort', 'true');
    if (durationSeconds) fd.append('DurationSeconds', String(durationSeconds));
    return json('/api/Posts', { method: 'POST', body: fd });
  },
  post: (id) => json(`/api/Posts/${id}`),
  userPosts: (userId, page = 1) => json(`/api/Posts/user/${userId}?page=${page}&pageSize=10`),
  deletePost: (id) => json(`/api/Posts/${id}`, { method: 'DELETE' }),
  like: (id) => json(`/api/Posts/${id}/like`, { method: 'POST' }),
  unlike: (id) => json(`/api/Posts/${id}/like`, { method: 'DELETE' }),
  comments: (id, page = 1) => json(`/api/Posts/${id}/comments?page=${page}`),
  addComment: (id, text) => json(`/api/Posts/${id}/comments`, { method: 'POST', body: JSON.stringify(text) }),
  bookmark: (id) => json(`/api/Posts/${id}/bookmark`, { method: 'POST' }),
  unbookmark: (id) => json(`/api/Posts/${id}/bookmark`, { method: 'DELETE' }),
  bookmarked: (page = 1) => json(`/api/Posts/bookmarked?page=${page}`),

  /* feed */
  feedFollowing: (page = 1) => json(`/api/Feed/following?page=${page}&pageSize=10`),
  feedExplore: (page = 1) => json(`/api/Feed/explore?page=${page}&pageSize=10`),
  feedShorts: (page = 1) => json(`/api/Feed/shorts?page=${page}&pageSize=10`),
  feedCourse: (courseId, page = 1) => json(`/api/Feed/course/${courseId}?page=${page}&pageSize=10`),

  /* cartoons — public-domain library content; the shelf needs no session */
  cartoons: ({ shelf = '', q = '', page = 1, pageSize = 18 } = {}) => {
    const params = new URLSearchParams();
    if (shelf) params.set('shelf', shelf);
    if (q) params.set('q', q);
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    return json(`/api/Cartoons?${params.toString()}`, { noAuth: true });
  },
  cartoon: (id) => json(`/api/Cartoons/${encodeURIComponent(id)}`, { noAuth: true }),

  /* courses */
  coursesAll: () => json('/api/Courses/all'),
  course: (id) => json(`/api/Courses/${id}`),
  createCourse: (b) => json('/api/Courses', { method: 'POST', body: JSON.stringify(b) }),
  isSubscribed: (id) => json(`/api/Courses/${id}/is-subscribed`),
  subscribeCourse: (id) => json(`/api/Courses/${id}/subscribe`, { method: 'POST' }),
  unsubscribeCourse: (id) => json(`/api/Courses/${id}/subscribe`, { method: 'DELETE' }),
  myCourses: () => json('/api/Courses/my-courses'),

  /* search */
  searchPosts: (q) => json(`/api/Search/posts?q=${encodeURIComponent(q)}`),
  searchUsers: (q) => json(`/api/Search/users?q=${encodeURIComponent(q)}`),
  searchCourses: (q) => json(`/api/Search/courses?q=${encodeURIComponent(q)}`),
  searchHashtags: (q) => json(`/api/Search/hashtags?q=${encodeURIComponent(q)}`),

  /* hashtags */
  trending: (count = 8) => json(`/api/Hashtags/trending?count=${count}`),

  /* notifications */
  notifications: (page = 1) => json(`/api/Notifications?page=${page}`),
  unreadCount: () => json('/api/Notifications/unread-count'),
  markRead: (id) => json(`/api/Notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => json('/api/Notifications/read-all', { method: 'POST' }),

  /* chat */
  conversations: () => json('/api/Chat/conversations'),
  directMessages: (userId, page = 1) => json(`/api/Chat/direct/${userId}?page=${page}`),
  courseMessages: (courseId, page = 1) => json(`/api/Chat/course/${courseId}?page=${page}`),
  chatUnread: () => json('/api/Chat/unread-count'),
  chatSearch: (q, take = 30) => json(`/api/Chat/search?q=${encodeURIComponent(q)}&take=${take}`),
  uploadAttachment: (file, { targetId, isCourse = false, caption = '', durationSeconds = null, clientId = null, replyToId = null }) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('targetId', targetId);
    fd.append('isCourse', String(isCourse));
    if (caption) fd.append('caption', caption);
    if (durationSeconds != null) fd.append('durationSeconds', String(durationSeconds));
    if (clientId) fd.append('clientId', clientId);
    if (replyToId) fd.append('replyToId', replyToId);
    return json('/api/Chat/attachments', { method: 'POST', body: fd });
  },

  /* calls */
  callHistory: (take = 50) => json(`/api/Call/history?take=${take}`),
  missedCalls: () => json('/api/Call/missed-count'),
  markMissedSeen: () => json('/api/Call/missed/seen', { method: 'POST' }),
  call: (id) => json(`/api/Call/${id}`),

  /* live */
  liveRooms: () => json('/api/LiveStream'),
  createRoom: (title, courseId = null) => json('/api/LiveStream', { method: 'POST', body: JSON.stringify({ title, courseId }) }),
  endRoom: (sid) => json(`/api/LiveStream/${sid}`, { method: 'DELETE' }),

  /* subscription */
  subStatus: () => json('/api/Subscription/status'),
  activatePremium: () => json('/api/Subscription/activate', { method: 'POST' }),
  cancelPremium: () => json('/api/Subscription/cancel', { method: 'DELETE' }),

  /* ads */
  ads: () => json('/api/Ads'),
  adImpression: (id) => json(`/api/Ads/${id}/impression`, { method: 'POST' }),
  adClick: (id) => json(`/api/Ads/${id}/click`, { method: 'POST' }),

  /* app timer */
  usageSummary: () => json('/api/AppTimer/summary'),
  setUsageLimit: (minutes) => json('/api/AppTimer/limit', { method: 'PUT', body: JSON.stringify({ minutes }) }),
  usageSession: (startIso, endIso) => json('/api/AppTimer/session', { method: 'POST', body: JSON.stringify({ sessionStart: startIso, sessionEnd: endIso }) }),

  /* AI */
  aiChat: (text) => json('/api/AI/chat', { method: 'POST', body: JSON.stringify(text) }),
  aiSummarize: (text) => json('/api/AI/summarize', { method: 'POST', body: JSON.stringify(text) }),
  aiTranslate: (text, lang) => json(`/api/AI/translate?targetLanguage=${encodeURIComponent(lang)}`, { method: 'POST', body: JSON.stringify(text) }),
  aiProviders: () => json('/api/AI/providers'),
  aiEnqueue: (prompt, kind = 'chat', tier = 'balanced') =>
    json('/api/AI/jobs', { method: 'POST', body: JSON.stringify({ prompt, kind, tier }) }),
  aiJob: (id) => json(`/api/AI/jobs/${id}`),

  /**
   * Server-sent-event token stream. Calls `onChunk` per token and resolves with the
   * full text. Returns an abort function so the UI can cancel mid-answer.
   */
  aiStream: (text, { onChunk, onError, signal } = {}) => {
    const controller = new AbortController();
    const composed = signal
      ? (() => { signal.addEventListener('abort', () => controller.abort()); return controller.signal; })()
      : controller.signal;

    const run = (async () => {
      const res = await fetch('/api/AI/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${store.access}` },
        body: JSON.stringify(text),
        signal: composed,
      });
      if (!res.ok) throw new Error(`AI stream failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let full = '';

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';

        for (const frame of frames) {
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (payload === '[DONE]') return full;
            try {
              const piece = JSON.parse(payload);
              full += piece;
              onChunk?.(piece, full);
            } catch { /* keep-alive or partial frame */ }
          }
        }
      }
      return full;
    })();

    run.catch(e => { if (e.name !== 'AbortError') onError?.(e); });
    return { abort: () => controller.abort(), done: run };
  },
};

export { store as _authStore };
