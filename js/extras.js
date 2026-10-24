/* Gen Z — command palette (Ctrl/⌘+K) and PWA install prompt. */
import { BRAND } from './brand.js';
import { icons } from './icons.js';
import { getTheme, setTheme } from './api.js';

const DESTINATIONS = [
  ['Home', '/feed', 'home'], ['Explore', '/explore', 'compass'], ['Shorts', '/shorts', 'play'],
  ['Cartoons', '/cartoons', 'video'], ['Live classes', '/live', 'radio'], ['Courses', '/courses', 'grad'],
  ['Messages', '/messages', 'chat'], ['Notifications', '/notifications', 'bell'],
  ['Campus Buddy (AI)', '/ai', 'sparkles'], ['Bookmarks', '/bookmarks', 'bookmark'],
  ['Your profile', '/profile', 'user'], ['Settings', '/settings', 'settings'],
];

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let isOpen = false;

export function openPalette() {
  if (isOpen || !document.getElementById('app')) return;
  isOpen = true;
  const previous = document.activeElement;
  const root = document.createElement('div');
  root.className = 'kz-pal-scrim';
  root.innerHTML = `<div class="kz-pal" role="dialog" aria-modal="true" aria-label="Quick actions">
    <div class="kz-pal-top"><span class="kz-pal-ico" aria-hidden="true">${icons.search || ''}</span>
      <input class="kz-pal-in" role="combobox" aria-expanded="true" aria-controls="kz-pal-list" aria-autocomplete="list"
        placeholder="Jump to a page or search ${esc(BRAND.name)}" autocomplete="off" spellcheck="false" aria-label="Quick actions">
      <kbd>Esc</kbd></div>
    <ul class="kz-pal-list" id="kz-pal-list" role="listbox" aria-label="Results"></ul></div>`;
  document.body.appendChild(root);

  const input = root.querySelector('input');
  const list = root.querySelector('ul');
  let items = [];
  let active = 0;

  const build = (q) => {
    const needle = q.trim().toLowerCase();
    const out = DESTINATIONS
      .filter(([label]) => !needle || label.toLowerCase().includes(needle))
      .map(([label, path, ic]) => ({ label, hint: 'Go to', ic, run: () => { location.hash = path; } }));
    if (needle) out.push({ label: `Search for “${q.trim()}”`, hint: 'Search', ic: 'search',
      run: () => { location.hash = `/search?q=${encodeURIComponent(q.trim())}`; } });
    const light = getTheme() === 'light';
    if (!needle || 'theme dark light appearance'.includes(needle))
      out.push({ label: light ? 'Switch to dark theme' : 'Switch to light theme', hint: 'Appearance', ic: light ? 'moon' : 'sun',
        run: () => setTheme(light ? 'dark' : 'light') });
    return out;
  };

  const paint = () => {
    list.innerHTML = items.length ? items.map((it, i) =>
      `<li id="kz-opt-${i}" role="option" aria-selected="${i === active}" class="kz-pal-item${i === active ? ' on' : ''}" data-i="${i}">
        <span class="kz-pal-ico" aria-hidden="true">${icons[it.ic] || ''}</span><span class="kz-pal-lbl">${esc(it.label)}</span>
        <span class="kz-pal-hint">${esc(it.hint)}</span></li>`).join('')
      : '<li class="kz-pal-empty" role="presentation">Nothing matches. Press Enter to search instead.</li>';
    input.setAttribute('aria-activedescendant', items.length ? `kz-opt-${active}` : '');
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  };

  const close = () => {
    isOpen = false;
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    previous?.focus?.();
  };
  const choose = (i) => { const it = items[i]; close(); it?.run(); };

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); active = items.length ? (active + 1) % items.length : 0; paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = items.length ? (active - 1 + items.length) % items.length : 0; paint(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (items.length) choose(active);
      else if (input.value.trim()) { const q = input.value.trim(); close(); location.hash = `/search?q=${encodeURIComponent(q)}`; }
    } else if (e.key === 'Tab') { e.preventDefault(); input.focus(); }
  }

  input.addEventListener('input', () => { items = build(input.value); active = 0; paint(); });
  list.addEventListener('click', (e) => { const li = e.target.closest('[data-i]'); if (li) choose(+li.dataset.i); });
  list.addEventListener('pointermove', (e) => {
    const li = e.target.closest('[data-i]');
    if (li && +li.dataset.i !== active) { active = +li.dataset.i; paint(); }
  });
  root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });
  document.addEventListener('keydown', onKey, true);

  items = build('');
  paint();
  input.focus();
}

let installEvent = null;

export function wireInstall(btn) {
  if (!btn) return;
  if (installEvent) btn.hidden = false;
  window.addEventListener('kz:installable', () => { btn.hidden = false; });
  btn.addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice?.catch(() => {});
    installEvent = null;
    btn.hidden = true;
  });
}

const TITLES = { feed: 'Home', explore: 'Explore', shorts: 'Shorts', cartoons: 'Cartoons', live: 'Live classes', courses: 'Courses', messages: 'Messages',
  chat: 'Messages', notifications: 'Notifications', bookmarks: 'Saved posts', profile: 'Profile', settings: 'Settings', ai: 'Campus Buddy', search: 'Search', post: 'Post' };
let labelObserver = null;

/** Every screen gets one level-one heading and a real tab title, whatever the view renders. */
export function labelPage(main, routeKey) {
  const title = TITLES[routeKey] || (routeKey ? routeKey[0].toUpperCase() + routeKey.slice(1) : 'Home');
  document.title = `${title} | ${BRAND.name}`;
  labelObserver?.disconnect();
  let queued = 0;
  const ensure = () => {
    queued = 0;
    if (!main.isConnected || main.querySelector('h1, [role="heading"][aria-level="1"]')) return;
    const h = document.createElement('h1');
    h.className = 'kz-sr';
    h.textContent = title;
    main.prepend(h);
  };
  const queue = () => { if (!queued) queued = setTimeout(ensure, 250); };
  labelObserver = new MutationObserver(queue);
  labelObserver.observe(main, { childList: true });
  queue();
}

const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" fill="#2B303B"/><path d="M68 32v26l24-13z" fill="#FFC800"/></svg>');

export function initExtras() {
  // third-party posters (archive.org) can fail; show a neutral tile instead of a broken-image icon
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t instanceof HTMLImageElement && !t.dataset.kzFallback && t.closest('[class*="toon"], .post-media')) {
      t.dataset.kzFallback = '1';
      t.src = PLACEHOLDER;
    }
  }, true);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e;
    window.dispatchEvent(new CustomEvent('kz:installable'));
  });
  window.addEventListener('appinstalled', () => { installEvent = null; });
}

/* ── "On the way" panels ──
   When a section's backend route is not live yet, an empty list would read as "you have no
   messages / nobody is live", which is untrue. Say what is actually happening instead. */
const SOON = [
  { routes: ['messages', 'chat'], test: /^\/api\/Chat\//, icon: 'chat', title: 'Messages are almost here',
    text: 'Direct chats and course group chats are being switched on. Nothing is wrong on your end.' },
  { routes: ['notifications'], test: /^\/api\/Notifications/, icon: 'bell', title: 'Notifications are on the way',
    text: 'Likes, replies, new followers and live alerts will land here once they are switched on.' },
  { routes: ['live'], test: /^\/api\/LiveStream/, icon: 'radio', title: 'Live classes are on the way',
    text: 'Going live and watching classmates stream is being switched on. We will let you know.' },
  { routes: ['courses'], test: /^\/api\/Courses\//, icon: 'grad', title: 'Courses are on the way',
    text: 'Course pages, feeds and group chats are being switched on.' },
  { routes: ['shorts'], test: /^\/api\/Feed\/shorts/, icon: 'play', title: 'Shorts are on the way',
    text: 'The vertical video feed is being switched on. Cartoons are live in the meantime.' },
  { routes: ['bookmarks'], test: /^\/api\/Posts\/bookmarked/, icon: 'bookmark', title: 'Saved posts are on the way',
    text: 'Bookmarking is being switched on. Your saves will appear here.' },
  { routes: ['search'], test: /^\/api\/Search\//, icon: 'search', title: 'Search is on the way',
    text: 'People, posts, courses and tags will be searchable soon. Use the Ctrl+K menu to jump around meanwhile.' },
  { routes: ['feed'], tab: 'following', target: '#feed-list', test: /^\/api\/Feed\/following/, icon: 'users',
    title: 'Following feed is on the way', text: 'Posts from people you follow will show here. For you is live now.', compact: true },
  { routes: ['feed'], tab: 'courses', target: '#feed-list', test: /^\/api\/(Courses\/my-courses|Feed\/course)/, icon: 'grad',
    title: 'Course feeds are on the way', text: 'Posts from your courses will show here once they are switched on.', compact: true },
];

let guardToken = 0;

export function guardRollout(main, routeKey, tab) {
  const token = ++guardToken;
  let timer = 0;
  const stop = () => { window.removeEventListener('kz:degraded-path', onPath); clearTimeout(timer); };
  function onPath(ev) {
    if (token !== guardToken || !main.isConnected) return stop();
    const hit = SOON.find(s => s.routes.includes(routeKey) && (!s.tab || s.tab === tab) && s.test.test(ev.detail.path));
    if (!hit) return;
    stop();
    // Let the view finish its own render first, then replace it, so nothing is appended afterwards.
    setTimeout(() => {
      if (token !== guardToken || !main.isConnected) return;
      const target = hit.target ? main.querySelector(hit.target) : main;
      if (!target) return;
      const panel = document.createElement('div');
      panel.className = 'kz-soon';
      panel.setAttribute('role', 'status');
      panel.innerHTML = `<div class="kz-soon-art" aria-hidden="true">${icons[hit.icon] || ''}</div>
        <h2>${esc(hit.title)}</h2><p>${esc(hit.text)}</p>
        ${hit.compact ? '' : '<a class="btn btn-primary" href="#/feed">Back to Home</a>'}`;
      target.replaceChildren(panel);
    }, 220);
  }
  window.addEventListener('kz:degraded-path', onPath);
  timer = setTimeout(stop, 6000);
}
