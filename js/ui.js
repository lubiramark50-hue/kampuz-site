/* StreamCampus — DOM + formatting helpers */
import { icons } from './icons.js';

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Escape then linkify #hashtags */
export const rich = (s) => esc(s)
  .replace(/(^|\s)#([\p{L}\p{N}_]{1,50})/gu, '$1<span class="hashtag" data-tag="$2">#$2</span>');

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = `icn ${cls}`;
  span.innerHTML = icons[name] || '';
  span.style.display = 'inline-flex';
  return span;
}

const AV_GRADS = [ // flat fills, all >= 4.5:1 against white initials
  '#0E7490', '#7C3AED', '#BE185D', '#B45309', '#047857', '#1D4ED8', '#B91C1C', '#4D7C0F',
];

export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?';
}

/** Avatar element with graceful initials fallback */
export function avatar(userOrName, size = 40, url = null) {
  const name = typeof userOrName === 'string' ? userOrName : (userOrName?.fullName || userOrName?.name || '?');
  const src = typeof userOrName === 'object' ? (userOrName?.avatarUrl) : url;
  const el = document.createElement('div');
  el.className = 'avatar';
  el.dataset.size = String(size);
  // Size from the argument rather than relying on a fixed list of CSS rules — any
  // caller can ask for any diameter (the call ring uses 108px, for example).
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.fontSize = `${Math.max(11, Math.round(size * 0.36))}px`;
  // deterministic gradient from name
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  el.style.background = AV_GRADS[hash % AV_GRADS.length];
  el.textContent = initials(name);
  if (src) {
    const img = new Image();
    img.alt = name;
    img.loading = 'lazy';
    img.onerror = () => img.remove();
    img.src = src;
    el.appendChild(img);
  }
  return el;
}

export function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso), s = (Date.now() - d.getTime()) / 1000;
  if (s < 45) return 'now';
  if (s < 3600) return `${Math.max(1, s / 60 | 0)}m`;
  if (s < 86400) return `${s / 3600 | 0}h`;
  if (s < 604800) return `${s / 86400 | 0}d`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fmtCount(n = 0) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

export function fmtDuration(totalMin) {
  const h = totalMin / 60 | 0, m = totalMin % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/* ───────── toasts ───────── */
export function toast(msg, type = 'ok', ms = 3200) {
  const box = document.getElementById('toasts');
  const el = h(`<div class="toast ${type}">${icon(type === 'ok' ? 'check' : type === 'err' ? 'x' : 'bell').outerHTML}<span>${esc(msg)}</span></div>`);
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, ms);
}

/* ───────── modal ───────── */
export function openModal({ title = '', body, footer = '', large = false, onClose = null }) {
  const root = document.getElementById('modal-root');
  const backdrop = h(`<div class="modal-backdrop"></div>`);
  const modal = h(`<div class="modal ${large ? 'modal-lg' : ''}" role="dialog" aria-modal="true">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close>${icon('x').outerHTML}</button></div>
    <div class="modal-body">${body}</div>
    ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
  </div>`);
  backdrop.appendChild(modal);
  root.appendChild(backdrop);

  const close = () => { backdrop.remove(); onClose?.(); };
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  modal.querySelector('[data-close]').addEventListener('click', close);
  document.addEventListener('keydown', function esc1(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc1); }
  });
  return { modal, close };
}

export function confirmDialog(title, text, confirmLabel = 'Delete') {
  return new Promise(resolve => {
    const { close } = openModal({
      title,
      body: `<p style="color:var(--text-2)">${esc(text)}</p>`,
      footer: `<button class="btn btn-ghost" data-no>Cancel</button><button class="btn btn-danger" data-yes>${esc(confirmLabel)}</button>`,
      onClose: () => resolve(false),
    });
    close && 0;
    const m = document.querySelector('#modal-root .modal:last-of-type');
    m?.parentElement?.addEventListener('click', e => {
      if (e.target.closest('[data-yes]')) { resolve(true); close(); }
      if (e.target.closest('[data-no]')) { resolve(false); close(); }
    }, { once: false });
  });
}

/* ───────── lightbox ───────── */
export function lightbox(src, isVideo = false) {
  const root = document.getElementById('lightbox-root');
  const el = h(`<div class="lightbox-backdrop">
    <button class="lb-x">${icon('x').outerHTML}</button>
    ${isVideo ? `<video src="${esc(src)}" controls autoplay></video>` : `<img src="${esc(src)}" alt="">`}
  </div>`);
  root.appendChild(el);
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('.lb-x')) el.remove(); });
}

/* ───────── skeleton helpers ───────── */
export function skeletonPost() {
  return h(`<div class="skeleton" style="height:190px"></div>`);
}
export function emptyState(iconName, title, text, action = '') {
  return h(`<div class="empty-state">
    <div class="es-art">${icon(iconName).outerHTML}</div>
    <h3>${esc(title)}</h3><p>${esc(text)}</p>${action}
  </div>`);
}

/** navigate helper — set by router to avoid circular import */
export const nav = { go: (path) => { location.hash = path; } };

/* debounce */
export function debounce(fn, ms = 300) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/** format file size */
export function fmtBytes(b) {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(1) + ' MB';
  if (b >= 1e3) return (b / 1e3).toFixed(0) + ' KB';
  return b + ' B';
}
