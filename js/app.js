/* Kampuz — SPA router + app shell */
import { api, session, loadSession, getTheme, setTheme, clearSession, saveSession } from './api.js';
import { esc, h, icon, toast, avatar, timeAgo, nav } from './ui.js';
import { renderAuth } from './views/auth.js';
import { renderFeed } from './views/feed.js';
import { renderExplore } from './views/explore.js';
import { renderShorts } from './views/shorts.js';
import { renderCartoons, renderCartoonPlayer } from './views/cartoons.js';
import { renderChat } from './views/chat.js';
import { renderCourses } from './views/courses.js';
import { renderLive } from './views/live.js';
import { renderProfile } from './views/profile.js';
import { renderNotifications } from './views/notifications.js';
import { renderSearch } from './views/search.js';
import { renderSettings } from './views/settings.js';
import { renderAI } from './views/ai.js';
import { connectChat, chatHub, startUsageHeartbeat, disconnectChat, stopUsageHeartbeat, disconnectCall, disconnectLive } from './realtime.js';
import { initCalls } from './call/ui.js';
import { unlockAudio } from './call/ringtone.js';
import { postCard, suggestionRow, adCard } from './components.js';
import { BRAND, logoMark, wordmark } from './brand.js';
import { initExtras, wireInstall, guardRollout, labelPage } from './extras.js';

const appRoot = document.getElementById('app');
let me = null; // full profile (UserProfileDto)

/* Network state: make degraded/recovered connectivity visible without blocking the app. */
function initNetworkStatus() {
  if (document.getElementById('network-status')) return;
  const el = document.createElement('div');
  el.id = 'network-status';
  el.className = 'network-status';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = '<span class="network-status-dot" aria-hidden="true"></span><span class="network-status-copy"></span>';
  document.body.appendChild(el);

  let hideTimer = 0;
  const update = (online, announce = false) => {
    window.clearTimeout(hideTimer);
    el.classList.toggle('is-offline', !online);
    el.classList.toggle('is-online', online && announce);
    el.querySelector('.network-status-copy').textContent = online
      ? `Back online — ${BRAND.name} is synced.`
      : 'You’re offline — some updates may wait until you reconnect.';
    if (online && announce) hideTimer = window.setTimeout(() => el.classList.remove('is-online'), 3200);
  };

  update(navigator.onLine, false);
  window.addEventListener('offline', () => {
    update(false, true);
    window.dispatchEvent(new CustomEvent('sc:offline'));
  });
  window.addEventListener('online', () => {
    update(true, true);
    window.dispatchEvent(new CustomEvent('sc:online'));
  });
}
initNetworkStatus();

setTheme(getTheme());
loadSession();

/* dev/test convenience: ?token=&refresh=&uid=&name= logs straight in */
(function queryLogin() {
  const qp = new URLSearchParams(location.search);
  if (!qp.get('token')) return;
  saveSession({
    accessToken: qp.get('token'),
    refreshToken: qp.get('refresh') || '',
    userId: qp.get('uid') || '',
    email: qp.get('email') || '',
    fullName: qp.get('name') || 'Student',
  });
  history.replaceState(null, '', location.pathname + location.hash);
})();

/* ─────────────────────────── router ─────────────────────── */
function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = Object.fromEntries(new URLSearchParams(query || ''));
  return { path, parts, params };
}

function route() {
  const { parts, params } = parseHash();
  if (!session.isLoggedIn) { renderAuth(appRoot, boot); return; }
  if (!me) { renderAuth(appRoot, boot); return; }

  const main = document.querySelector('.main-col');
  if (!main) { renderShell().then(route); return; }

  // fullscreen stages handle themselves
  window.scrollTo({ top: 0 });

  const [a, b, c] = parts;
  try {
    if (!a || a === 'feed') renderFeed(main, { tab: b === 'following' ? 'following' : b === 'courses' ? 'courses' : 'foryou' });
    else if (a === 'explore') renderExplore(main);
    else if (a === 'shorts') renderShorts(main, { index: +(params.i || 0) });
    else if (a === 'cartoons')
      b ? renderCartoonPlayer(main, decodeURIComponent(b))
        : renderCartoons(main, { shelf: params.shelf || '', q: params.q || '' });
    else if (a === 'live') renderLive(main);
    else if (a === 'courses') renderCourses(main, { id: b || null });
    else if (a === 'chat') renderChat(main, { id: b || null, type: c || 'direct' });
    else if (a === 'messages') renderChat(main, { id: b || null, tab: params.tab === 'calls' ? 'calls' : 'chats' });
    else if (a === 'user') renderProfile(main, { id: b || me.id });
    else if (a === 'profile') renderProfile(main, { id: me.id });
    else if (a === 'notifications') renderNotifications(main);
    else if (a === 'search') renderSearch(main, { q: params.q || '' });
    else if (a === 'settings') renderSettings(main);
    else if (a === 'ai') renderAI(main);
    else if (a === 'post') renderSinglePost(main, b);
    else if (a === 'bookmarks') renderBookmarks(main);
    else renderFeed(main, {});
  } catch (e) {
    console.error(e);
    main.innerHTML = `<div class="card" style="padding:24px;color:var(--danger)">Something went wrong: ${esc(e.message)}</div>`;
  }
  document.body.dataset.route = a || 'feed';
  labelPage(main, a || 'feed');
  guardRollout(main, a || 'feed', (!a || a === 'feed') ? (b === 'following' ? 'following' : b === 'courses' ? 'courses' : 'foryou') : undefined);
  updateActiveNav();
}

async function renderSinglePost(main, id) {
  main.innerHTML = `<div class="spinner"></div>`;
  try {
    const post = await api.post(id);
    main.innerHTML = `<div class="page-head"><h1>Post</h1></div>`;
    main.appendChild(postCard(post));
  } catch (e) {
    main.innerHTML = `<div class="card" style="padding:26px;text-align:center;color:var(--text-2)">
      <p style="font-weight:800;font-size:16px;margin-bottom:6px">Post not found</p>
      <p style="font-size:13.5px">${esc(e.message)}</p></div>`;
  }
}

async function renderBookmarks(main) {
  main.innerHTML = `<div class="page-head"><h1>Bookmarks</h1></div><div class="spinner"></div>`;
  try {
    const posts = await api.bookmarked();
    main.innerHTML = `<div class="page-head"><h1>Bookmarks</h1><span class="grow"></span>
      <p class="ph-sub">${posts.length} saved</p></div>`;
    if (!posts.length) {
      main.insertAdjacentHTML('beforeend', `<div class="empty-state">
        <div class="es-art">${icon('bookmark').outerHTML}</div>
        <h3>Nothing saved yet</h3><p>Tap the bookmark icon on any post to keep it here for later.</p></div>`);
      return;
    }
    posts.forEach(p => main.appendChild(postCard(p)));
  } catch (e) {
    main.innerHTML = `<div class="card" style="padding:22px;color:var(--danger)">${esc(e.message)}</div>`;
  }
}

/* ─────────────────────────── shell ──────────────────────── */
async function renderShell() {
  const { parts } = parseHash();
  const wide = parts[0] === 'shorts' || parts[0] === 'live' && false;
  // Messaging needs horizontal room: a 330px thread list inside a 620px column left the
  // conversation pane too narrow to read, so bubbles wrapped after a few words.
  const chatWide = parts[0] === 'messages' || parts[0] === 'chat';

  appRoot.innerHTML = `
    <header class="mobile-header">
      ${logoMark(34)}
      <b class="kz-word kz-word-sm">${wordmark()}</b>
      <span class="grow" style="flex:1"></span>
      <button class="icon-btn" data-m-search aria-label="Search">${icon('search').outerHTML}</button>
      <button class="icon-btn" data-m-bell aria-label="Notifications" style="position:relative">${icon('bell').outerHTML}<span class="m-bell-badge" style="position:absolute;top:2px;right:2px"></span></button>
    </header>
    <div class="app-shell ${chatWide ? 'chat-wide' : ''}">
      <nav class="side-nav">
        <div class="brand">${logoMark(38)}<span class="brand-name">${wordmark()}</span></div>
        <button class="nav-create" data-create>${icon('plus').outerHTML}<span>Create</span></button>
        <a class="nav-item" data-nav="/feed" href="#/feed">${icon('home').outerHTML}<span>Home</span></a>
        <a class="nav-item" data-nav="/explore" href="#/explore">${icon('compass').outerHTML}<span>Explore</span></a>
        <a class="nav-item" data-nav="/shorts" href="#/shorts">${icon('play').outerHTML}<span>Shorts</span></a>
        <a class="nav-item" data-nav="/cartoons" href="#/cartoons">${icon('video').outerHTML}<span>Cartoons</span></a>
        <a class="nav-item" data-nav="/live" href="#/live">${icon('radio').outerHTML}<span>Live</span></a>
        <a class="nav-item" data-nav="/courses" href="#/courses">${icon('grad').outerHTML}<span>Courses</span></a>
        <a class="nav-item" data-nav="/messages" href="#/messages">${icon('chat').outerHTML}<span>Messages</span></a>
        <a class="nav-item" data-nav="/notifications" href="#/notifications">${icon('bell').outerHTML}<span>Notifications</span></a>
        <a class="nav-item" data-nav="/ai" href="#/ai">${icon('sparkles').outerHTML}<span>Campus Buddy</span></a>
        <a class="nav-item" data-nav="/settings" href="#/settings">${icon('settings').outerHTML}<span>Settings</span></a>
        <div class="nav-spacer"></div>
        <a class="nav-user" data-nav="/profile" href="#/profile">
          <span class="nu-av"></span>
          <span class="nu-meta"><span class="nu-name">${esc(me.fullName)}</span><br><span class="nu-handle">@${esc((me.universityEmail || 'campus').split('@')[0])}</span></span>
          <span class="nu-more">${icon('more').outerHTML}</span>
        </a>
        <button class="nav-item" data-install hidden>${icon('download').outerHTML}<span>Install app</span></button>
        <button class="nav-item" data-logout title="Log out">${icon('logout').outerHTML}<span>Log out</span></button>
      </nav>
      <main class="main-col"></main>
      <aside class="rail-col"><div class="rail">
        <div class="rail-card" style="padding:6px 14px">
          <div class="search-box" style="position:relative;display:flex;align-items:center">
            <span style="position:absolute;color:var(--text-3);display:flex">${icon('search').outerHTML}</span>
            <input id="rail-search" aria-label="Search ${BRAND.name}" placeholder="Search ${BRAND.name}" style="width:100%;border:0;background:none;outline:none;padding:12px 44px 12px 32px;color:var(--text);font-size:14px"><kbd class="kz-kbd" aria-hidden="true">Ctrl K</kbd>
          </div>
        </div>
        <div id="rail-live"></div>
        <div id="rail-toons"></div>
        <div class="rail-card" id="rail-trends"><h3>${icon('fire').outerHTML} Trending</h3><div class="spinner"></div></div>
        <div class="rail-card" id="rail-suggested"><h3>${icon('users').outerHTML} Who to follow</h3><div class="spinner"></div></div>
        <div class="usage-card rail-card"><h3>${icon('timer').outerHTML} Screen time</h3><div class="spinner"></div></div>
        <div id="rail-ad"></div>
        <p style="text-align:center;color:var(--text-3);font-size:12px;padding:4px 0 12px">${BRAND.legal}<br>Made in Uganda</p>
      </div></aside>
    </div>
    <nav class="mobile-tabs">
      <a class="tab" data-nav="/feed" href="#/feed">${icon('home').outerHTML}<span>Home</span></a>
      <a class="tab" data-nav="/explore" href="#/explore">${icon('compass').outerHTML}<span>Explore</span></a>
      <a class="tab tab-create" href="#/shorts">${icon('play').outerHTML}<span>Shorts</span></a>
      <a class="tab" data-nav="/courses" href="#/courses">${icon('grad').outerHTML}<span>Courses</span></a>
      <a class="tab" data-nav="/messages" href="#/messages">${icon('chat').outerHTML}<span>Chats</span></a>
      <a class="tab" data-nav="/profile" href="#/profile">${icon('user').outerHTML}<span>You</span></a>
    </nav>`;

  // avatar
  const av = avatar(me, 40);
  appRoot.querySelector('.nu-av').replaceWith(av);

  // wire nav actions
  appRoot.querySelector('[data-create]').addEventListener('click', () => location.hash = '/feed');
  appRoot.querySelector('[data-logout]').addEventListener('click', logout);
  wireInstall(appRoot.querySelector('[data-install]'));
  appRoot.querySelector('[data-m-search]').addEventListener('click', () => location.hash = '/search');
  appRoot.querySelector('[data-m-bell]').addEventListener('click', () => location.hash = '/notifications');
  appRoot.querySelector('#rail-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) location.hash = `/search?q=${encodeURIComponent(e.target.value.trim())}`;
  });

  updateActiveNav();
  refreshBadge();
  fillRail();

  // realtime + usage
  await connectChat();
  const hub = chatHub();
  hub?.off('notification');
  hub?.on('notification', (n) => {
    toast(`🔔 ${n?.title || 'New notification'}`, 'info', 3500);
    refreshBadge();
  });
  // Ringing must reach the user on any screen, so the call plane comes up with the shell.
  await initCalls();
  refreshMessageBadge();
  startUsageHeartbeat();
}

async function refreshMessageBadge() {
  try {
    const { count } = await api.chatUnread();
    const tab = appRoot.querySelector('.mobile-tabs .tab[data-nav="/messages"]');
    if (!tab) return;
    let badge = tab.querySelector('.tab-badge');
    if (count > 0) {
      if (!badge) { badge = h('<span class="tab-badge"></span>'); tab.appendChild(badge); }
      badge.textContent = count > 99 ? '99+' : count;
    } else badge?.remove();
  } catch { /* badge is cosmetic */ }
}

function updateActiveNav() {
  const { parts } = parseHash();
  const a = parts[0] || 'feed';
  document.querySelectorAll('[data-nav]').forEach(n => {
    const target = n.dataset.nav.replace(/^\//, '').split('/')[0] || 'feed';
    n.classList.toggle('active', target === a);
  });
}

async function fillRail() {
  // live now
  const liveBox = appRoot.querySelector('#rail-live');
  api.liveRooms().then(rooms => {
    if (!rooms.length) { liveBox.innerHTML = ''; return; }
    const card = h(`<div class="rail-card"><h3>${icon('radio').outerHTML} Live now</h3></div>`);
    rooms.slice(0, 3).forEach(r => {
      const row = h(`<div class="live-mini">
        <span class="lm-thumb" style="width:92px;aspect-ratio:16/10;border-radius:10px;background:var(--grad-violet);display:grid;place-items:center;font-size:20px">📺</span>
        <div style="min-width:0"><div class="lm-title">${esc(r.title)}</div>
        <div class="lm-host">${esc(r.hostName)} · ${fmtViewers(r.viewerCount)}</div></div>
      </div>`);
      row.addEventListener('click', () => location.hash = '/live');
      card.appendChild(row);
    });
    liveBox.innerHTML = '';
    liveBox.appendChild(card);
  }).catch(() => { liveBox.innerHTML = ''; });

  // cartoons shelf (public library, works without the social backend)
  api.cartoons({ pageSize: 3 }).then(page => {
    const box = appRoot.querySelector('#rail-toons');
    if (!box || !page?.items?.length) return;
    const card = h(`<div class="rail-card"><h3>${icon('video').outerHTML} Cartoons</h3></div>`);
    page.items.slice(0, 3).forEach(t => {
      card.appendChild(h(`<a class="kz-toon-row" href="#/cartoons/${encodeURIComponent(t.id)}">
        <img src="${esc(t.posterUrl)}" alt="" width="52" height="72" loading="lazy" decoding="async">
        <span><b>${esc(t.title)}</b><small>${t.year ? esc(String(t.year)) : 'Classic'}</small></span></a>`));
    });
    card.appendChild(h('<a class="kz-more" href="#/cartoons">Browse all cartoons</a>'));
    box.appendChild(card);
  }).catch(() => {});

  // trending
  api.trending(8).then(tags => {
    const box = appRoot.querySelector('#rail-trends');
    if (tags.degraded) { box.remove(); return; }
    if (!tags.length) { box.innerHTML = `<h3>${icon('fire').outerHTML} Trending</h3><p style="color:var(--text-3);font-size:13px">Post with a #hashtag to start a trend!</p>`; return; }
    box.innerHTML = `<h3>${icon('fire').outerHTML} Trending</h3>`;
    tags.forEach(t => {
      const row = h(`<div class="trend-row"><span class="tr-tag">#${esc(t.tag)}</span><span class="tr-count">${t.count} posts</span></div>`);
      row.addEventListener('click', () => location.hash = `/search?q=%23${t.tag}`);
      box.appendChild(row);
    });
  }).catch(() => {});

  // suggested
  api.suggested(5).then(users => {
    const box = appRoot.querySelector('#rail-suggested');
    if (users.degraded) { box.remove(); return; }
    if (!users.length) { box.innerHTML = `<h3>${icon('users').outerHTML} Who to follow</h3><p style="color:var(--text-3);font-size:13px">You follow everyone — campus celebrity! 🌟</p>`; return; }
    box.innerHTML = `<h3>${icon('users').outerHTML} Who to follow</h3>`;
    users.forEach(u => box.appendChild(suggestionRow(u)));
  }).catch(() => {});

  // usage
  api.usageSummary().then(u => {
    const box = appRoot.querySelector('.usage-card');
    if (u.degraded) { box.remove(); return; }
    const pct = u.dailyLimitMinutes ? Math.min(100, u.totalMinutesToday / u.dailyLimitMinutes * 100) : Math.min(100, u.totalMinutesToday / 480 * 100);
    box.innerHTML = `<h3>${icon('timer').outerHTML} Screen time today</h3>
      <div style="font-weight:800;font-size:20px">${fmtMin(u.totalMinutesToday)}</div>
      <div class="usage-bar"><i style="width:${pct}%"></i></div>
      <p class="usage-note">${u.dailyLimitMinutes ? `Limit ${fmtMin(u.dailyLimitMinutes)} · ${u.limitExceeded ? 'limit reached 🌱' : 'on track'}` : 'Set a daily limit in Settings'}</p>`;
  }).catch(() => {});

  // ad (if not premium)
  api.ads().then(ads => {
    const box = appRoot.querySelector('#rail-ad');
    box.innerHTML = '';
    if (ads.length) box.appendChild(adCard(ads[0]));
  }).catch(() => {});
}

function fmtViewers(n) { return `${n} watching`; }
function fmtMin(m) { const h2 = m / 60 | 0; return h2 ? `${h2}h ${m % 60}m` : `${m}m`; }

async function refreshBadge() {
  try {
    const { count } = await api.unreadCount();
    document.querySelectorAll('.nav-item[data-nav="/notifications"]').forEach(() => {});
    const navItem = appRoot.querySelector('.nav-item[data-nav="/notifications"]');
    if (navItem) {
      let badge = navItem.querySelector('.badge');
      if (count > 0) {
        if (!badge) { badge = h(`<span class="badge"></span>`); navItem.appendChild(badge); }
        badge.textContent = count > 9 ? '9+' : count;
      } else badge?.remove();
    }
    const mb = appRoot.querySelector('.m-bell-badge');
    if (mb) { mb.textContent = count > 0 ? (count > 9 ? '9+' : count) : ''; mb.style.display = count > 0 ? 'grid' : 'none'; mb.style.cssText += 'min-width:16px;height:16px;border-radius:8px;background:var(--accent-2);color:#fff;font-size:9.5px;font-weight:800;place-items:center;padding:0 4px'; }
  } catch {}
}

async function logout() {
  await api.logout().catch(() => {});
  disconnectChat();
  disconnectCall();
  disconnectLive();
  stopUsageHeartbeat();
  clearSession();
  location.hash = '/auth';
  location.reload();
}

/* ─────────────────────────── boot ────────────────────────── */
async function boot() {
  if (!session.isLoggedIn) { renderAuth(appRoot, boot); return; }
  try {
    me = await api.me();
    // keep cached session user fresh
    const u = session.user;
    if (u && me.fullName !== u.fullName) { u.fullName = me.fullName; session.setUser(u); }
  } catch (e) {
    // token invalid & refresh failed → auth screen
    renderAuth(appRoot, boot);
    return;
  }
  window.scUser = me;
  await renderShell();
  route();
}

window.addEventListener('hashchange', route);
window.addEventListener('kz:degraded', () => {
  if (sessionStorage.getItem('kz_degraded_told')) return;
  sessionStorage.setItem('kz_degraded_told', '1');
  toast('Some features are still rolling out.', 'info', 4200);
});
window.addEventListener('sc:refresh-badge', refreshBadge);
window.addEventListener('sc:logout', () => { location.hash = '/auth'; location.reload(); });
window.addEventListener('sc:call-ended', () => {
  refreshMessageBadge();
  window.dispatchEvent(new CustomEvent('sc:refresh-convos'));
});

// Browsers block audio until the user interacts; this unlocks ringtones on first tap.
['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
  window.addEventListener(ev, unlockAudio, { once: true, passive: true }));

// keyboard: / focuses search, n = new post
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === '/') { e.preventDefault(); location.hash = '/search'; }
});

initExtras();
boot();
