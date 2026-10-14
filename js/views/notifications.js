/* StreamCampus — Notifications page */
import { api } from '../api.js';
import { esc, h, icon, timeAgo, avatar, emptyState, nav } from '../ui.js';

export async function renderNotifications(root) {
  root.innerHTML = '';
  const el = h(`<div>
    <div class="page-head">
      <h1>Notifications</h1><span class="grow"></span>
      <button class="btn btn-ghost btn-sm" data-readall>${icon('check').outerHTML} Mark all read</button>
    </div>
    <div class="card" id="notif-list"><div class="spinner"></div></div>
  </div>`);
  root.appendChild(el);

  el.querySelector('[data-readall]').addEventListener('click', async () => {
    try { await api.markAllRead(); renderNotifications(root); window.dispatchEvent(new CustomEvent('sc:refresh-badge')); }
    catch (e) { toastMsg(e.message); }
  });

  const list = el.querySelector('#notif-list');
  try {
    const notifs = await api.notifications();
    list.innerHTML = '';
    if (!notifs.length) {
      list.appendChild(emptyState('bell', 'All caught up', 'Likes, comments, new followers and live alerts will show up here.'));
      return;
    }
    for (const n of notifs) list.appendChild(notifRow(n));
  } catch (e) {
    list.innerHTML = '';
    list.appendChild(emptyState('x', 'Could not load notifications', e.message));
  }
}

function notifRow(n) {
  let data = {};
  try { data = JSON.parse(n.data || '{}'); } catch {}
  const type = data.type || 'system';
  const iconMap = { like: 'heart', comment: 'comment', follow: 'users', livestream: 'radio', system: 'bell' };

  const el = h(`<div class="notif-row ${n.isRead ? '' : 'unread'}">
    <span class="notif-icon ${esc(type)}">${icon(iconMap[type] || 'bell').outerHTML}</span>
    <div class="notif-body" style="flex:1">
      <div class="nb-title">${esc(n.title)}</div>
      <div class="nb-text">${esc(n.body)}</div>
      <div class="nb-time">${timeAgo(n.createdAt)}</div>
    </div>
  </div>`);

  el.addEventListener('click', async () => {
    if (!n.isRead) { api.markRead(n.id).catch(() => {}); el.classList.remove('unread'); window.dispatchEvent(new CustomEvent('sc:refresh-badge')); }
    if (type === 'follow' && data.userId) nav.go(`/user/${data.userId}`);
    else if (data.postId) nav.go(`/post/${data.postId}`);
    else if (type === 'livestream') nav.go('/live');
  });
  return el;
}

function toastMsg(m) { import('../ui.js').then(ui => ui.toast(m, 'err')); }
